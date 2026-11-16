import {ensureIntegrationTables,providerAccessToken} from "./integrations.js";
import {resolveKlosquesCalendars} from "./klosques-calendars.js";

// Suppression durable d'une demande issue du site : la fiche peut être retirée
// même lorsque Google est indisponible. Son événement est supprimé au premier
// essai possible, sans jamais toucher aux autres agendas/événements.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE_ROLES=new Set(["owner","writer","writerWithoutPrivateAccess"]);
const eventIdFor=id=>"klo"+id.replace(/-/g,"").toLowerCase();
const eventUrl=(calendar,id)=>"https://www.googleapis.com/calendar/v3/calendars/"+
  encodeURIComponent(calendar)+"/events/"+encodeURIComponent(id);

// Enregistrer la suppression distante et effacer la demande dans une seule
// transaction D1. La file n'est pas une confirmation de suppression Google.
export async function deleteSiteBookingAndQueueGoogle(env,booking){
  if(!booking||booking.source!=="site"||!UUID.test(booking.id||""))
    throw Error("Demande du site invalide.");
  const DB=env.DB;
  await ensureIntegrationTables(DB);
  const link=await DB.prepare(
    "SELECT calendar_id,event_id FROM google_concert_links WHERE booking_id=?"
  ).bind(booking.id).first();
  const id=link?.event_id||eventIdFor(booking.id);
  const calendar=link?.calendar_id||"";
  const results=await DB.batch([
    DB.prepare(
      "INSERT INTO google_pending_removals(booking_id,calendar_id,event_id) VALUES(?,?,?) "+
      "ON CONFLICT(booking_id) DO UPDATE SET calendar_id=excluded.calendar_id,event_id=excluded.event_id"
    ).bind(booking.id,calendar,id),
    DB.prepare("DELETE FROM bookings WHERE id=? AND source='site'").bind(booking.id)
  ]);
  if(!results?.[1]?.meta?.changes)
    throw Error("Demande non supprimée : réactualise les dossiers.");
  // L'association Google demeure jusqu'à confirmation de la suppression.
  return{queued:true,booking_id:booking.id};
}

async function forgetVerifiedRemoval(DB,row){
  // Après une suppression confirmée par Google (ou événement déjà absent),
  // vider la file et l'ancien lien exact.
  await DB.batch([
    DB.prepare(
      "DELETE FROM google_concert_links WHERE booking_id=? AND event_id=?"
    ).bind(row.booking_id,row.event_id),
    DB.prepare(
      "DELETE FROM google_pending_removals WHERE booking_id=? AND event_id=?"
    ).bind(row.booking_id,row.event_id),
    DB.prepare("DELETE FROM google_event_optouts WHERE booking_id=?")
      .bind(row.booking_id)
  ]);
}

export async function flushPendingGoogleRemovals(env,{bookingId=null,limit=20}={}){
  const DB=env.DB;
  await ensureIntegrationTables(DB);
  if(bookingId!==null&&!UUID.test(bookingId))
    throw Error("Identifiant de demande invalide.");
  const bounded=Math.max(1,Math.min(20,Number(limit)||20));
  const query=bookingId
    ?"SELECT booking_id,calendar_id,event_id FROM google_pending_removals WHERE booking_id=?"
    :"SELECT booking_id,calendar_id,event_id FROM google_pending_removals ORDER BY created_at LIMIT ?";
  const {results:rows} = await DB.prepare(query).bind(bookingId??bounded).all();
  if(!rows?.length)return{processed:0,removed:0,already_absent:0,pending:0,failed:0};
  let token,calendar;
  try{
    token=await providerAccessToken(env,"google");
    const calendars=await resolveKlosquesCalendars(env,token);
    calendar=calendars.concerts;
    if(!calendar||!WRITE_ROLES.has(calendar.accessRole))
      throw Error("Aucun droit d'écriture sur KLOSQUES PARTAGE.");
  }catch(error){
    console.warn("Nettoyage Google différé",error?.message);
    return{processed:rows.length,removed:0,already_absent:0,pending:rows.length,failed:rows.length};
  }
  let removed=0,alreadyAbsent=0,failed=0;
  for(const row of rows){
    if(!UUID.test(row.booking_id)||!row.event_id||
       (row.calendar_id&&row.calendar_id!==calendar.id)){
      failed++;
      console.warn("Demande Google liée à un autre agenda ou identifiant invalide.");
      continue;
    }
    const url=eventUrl(calendar.id,row.event_id);
    try{
      const lookup=await fetch(url,{
        headers:{Authorization:"Bearer "+token}
      });
      if(lookup.status===404||lookup.status===410){
        await forgetVerifiedRemoval(DB,row);
        alreadyAbsent++;
        continue;
      }
      if(!lookup.ok)throw Error("Lecture événement Google refusée ("+lookup.status+").");
      const event=await lookup.json();
      if(event.extendedProperties?.private?.klosquesBookingId!==row.booking_id)
        throw Error("Marqueur de propriété Google différent : suppression interdite.");
      const headers={Authorization:"Bearer "+token};
      if(event.etag)headers["If-Match"]=event.etag;
      const deleted=await fetch(url+"?sendUpdates=none",{method:"DELETE",headers});
      if(!deleted.ok&&!([404,410].includes(deleted.status)))
        throw Error("Suppression Google refusée ("+deleted.status+").");
      await forgetVerifiedRemoval(DB,row);
      removed++;
    }catch(error){
      failed++;
      console.warn("Suppression Google à retenter",error?.message);
    }
  }
  return{
    processed:rows.length,removed,already_absent:alreadyAbsent,
    pending:failed,failed
  };
}
