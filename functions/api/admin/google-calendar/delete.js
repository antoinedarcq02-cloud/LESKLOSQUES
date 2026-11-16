import {authorize,respond,validDate} from "../../../_lib/admin-auth.js";
import {ensureIntegrationTables,providerAccessToken} from "../../../_lib/integrations.js";
import {resolveKlosquesCalendars} from "../../../_lib/klosques-calendars.js";

// Suppression exclusivement dans les deux agendas du groupe, après confirmation.
// Une fiche Manager éventuelle reste intacte.
const EDIT_ROLES=new Set(["owner","writer","writerWithoutPrivateAccess"]);
const KINDS=new Set(["concerts","unavailable"]);
const EVENT_ID=/^[A-Za-z0-9_.@-]{1,200}$/;
const BOOKING_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const endpoint=(cal,id)=>"https://www.googleapis.com/calendar/v3/calendars/"+
  encodeURIComponent(cal)+"/events/"+encodeURIComponent(id);

function parisDate(value){
  if(typeof value!=="string")return "";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "";
  const pieces=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date).map(part=>[part.type,part.value]));
  return pieces.year+"-"+pieces.month+"-"+pieces.day;
}

export async function onRequestPost(context){
  const auth=await authorize(context,true);
  if(auth.error)return auth.error;
  if(!["admin","member"].includes(auth.user?.role))
    return respond({error:"Suppression Google réservée aux comptes des musiciens."},403);
  let body;
  try{
    const raw=await context.request.text();
    if(raw.length>1000)return respond({error:"Requête trop longue."},413);
    body=JSON.parse(raw);
  }catch{return respond({error:"Requête invalide."},400);}
  if(body?.confirm!==true||!KINDS.has(body?.calendar)||
     !EVENT_ID.test(body?.event_id||"")||
     typeof body?.expected_title!=="string"||body.expected_title.length>150||
     !validDate(body?.expected_date)||
     typeof body?.expected_etag!=="string"||!body.expected_etag||
     body.expected_etag.length>200)
    return respond({error:"Suppression non confirmée ou événement invalide. Actualise l'agenda."},400);
  try{
    const DB=context.env.DB;
    await ensureIntegrationTables(DB);
    const token=await providerAccessToken(context.env,"google");
    const calendars=await resolveKlosquesCalendars(context.env,token);
    const selected=calendars[body.calendar];
    if(!selected||!EDIT_ROLES.has(selected.accessRole))
      return respond({error:"Droits de suppression manquants sur l'agenda partagé sélectionné."},403);
    const url=endpoint(selected.id,body.event_id);
    const existing=await fetch(url,{headers:{Authorization:"Bearer "+token}});
    if(existing.status===404||existing.status===410)
      return respond({error:"Cet événement n'existe plus. Actualise l'agenda."},409);
    if(!existing.ok)throw Error("Lecture de l'événement Google refusée ("+existing.status+").");
    const item=await existing.json();
    const start=item.start?.date||parisDate(item.start?.dateTime);
    const title=String(item.summary||(item.visibility==="private"?"Événement privé":"Sans titre")).slice(0,150);
    if(item.status==="cancelled"||item.etag!==body.expected_etag||
       start!==body.expected_date||title!==body.expected_title)
      return respond({error:"L'événement a changé depuis son affichage. Actualise l'agenda avant de supprimer."},409);
    const bookingId=item.extendedProperties?.private?.klosquesBookingId;
    // Ne jamais supprimer le dossier. Bloquer sa republication automatique s'il
    // provient du formulaire public ; garder les autres événements indépendants.
    const booking=BOOKING_ID.test(bookingId||"")?
      await DB.prepare("SELECT id,source FROM bookings WHERE id=?").bind(bookingId).first():null;
    const linked=booking?await DB.prepare(
      "SELECT calendar_id,event_id FROM google_concert_links WHERE booking_id=?"
    ).bind(bookingId).first():null;
    if(linked&&(linked.calendar_id!==selected.id||linked.event_id!==body.event_id))
      return respond({error:"L'association du dossier a changé. Actualise l'agenda."},409);
    const removed=await fetch(url+"?sendUpdates=none",{
      method:"DELETE",
      headers:{Authorization:"Bearer "+token,"If-Match":body.expected_etag}
    });
    if([404,410,412].includes(removed.status))
      return respond({error:"L'événement a changé ou a déjà été supprimé. Actualise l'agenda."},409);
    if(!removed.ok)throw Error("Suppression Google refusée ("+removed.status+").");
    if(booking?.source==="site"){
      await DB.prepare("INSERT OR IGNORE INTO google_event_optouts(booking_id) VALUES(?)")
        .bind(booking.id).run();
    }
    if(linked){
      await DB.prepare(
        "DELETE FROM google_concert_links WHERE booking_id=? AND calendar_id=? AND event_id=?"
      ).bind(booking.id,selected.id,body.event_id).run();
    }
    return respond({ok:true,deleted:true,calendar:body.calendar});
  }catch(error){
    console.warn("Suppression d'événement Google impossible",error?.message);
    return respond({error:"Impossible de supprimer cet événement. Vérifie la connexion Google et réessaie."},503);
  }
}
