import {ensureIntegrationTables,getConnected,providerAccessToken} from "./integrations.js";
import {resolveKlosquesCalendars} from "./klosques-calendars.js";

// Synchronisation non bloquante des demandes du formulaire public.
// Seul KLOSQUES PARTAGE est modifié. Aucune donnée de contact client n'est
// transférée vers Google. Les dossiers "nouveau" restent libres/transparent.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE=new Set(["nouveau","en_discussion","devis_envoye","option","confirme","termine"]);
const LABELS={
  nouveau:"Demande à traiter",
  en_discussion:"Demande en discussion",
  devis_envoye:"Devis envoyé",
  option:"Date en option",
  confirme:"Concert confirmé",
  termine:"Concert terminé"
};
const normalize=value=>String(value||"").replace(/[\u0000-\u001f\u007f]/g," ").trim();
const nextDay=date=>{
  const d=new Date(date+"T12:00:00Z");
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
};
const eventId=id=>"klo"+id.replace(/-/g,"").toLowerCase();
const owned=(item,id)=>item?.extendedProperties?.private?.klosquesBookingId===id;
async function googleRequest(url,token,method="GET",data){
  const response=await fetch(url,{
    method,
    headers:{Authorization:"Bearer "+token,...(data?{"Content-Type":"application/json"}:{})},
    body:data?JSON.stringify(data):undefined
  });
  const body=response.status===204?{}:await response.json().catch(()=>({}));
  return{ok:response.ok,status:response.status,body};
}
// Seuls les dossiers issus du formulaire de réservation du site entrent ici.
// Une suppression refusée laisse l'ancienne entrée Google intacte si elle ne
// porte pas le marqueur privé du bon dossier.
export async function syncRequestToGoogle(env,booking,{remove=false}={}){
  if(!booking||booking.source!=="site"||!UUID.test(booking.id||""))return{skipped:true};
  const DB=env.DB;
  if(!DB)return{skipped:true};
  await ensureIntegrationTables(DB);
  const connection=await getConnected(DB,"google");
  if(!connection&&!env.GOOGLE_REFRESH_TOKEN)return{skipped:true};
  const removeEvent=remove||booking.status==="refuse";
  if(!removeEvent&&(!ACTIVE.has(booking.status)||
      !/^\d{4}-\d{2}-\d{2}$/.test(booking.event_date||"")))return{skipped:true};
  const token=await providerAccessToken(env,"google");
  const calendars=await resolveKlosquesCalendars(env,token);
  const calendar=calendars.concerts;
  if(!["owner","writer","writerWithoutPrivateAccess"].includes(calendar.accessRole))
    throw Error("Droits d'écriture manquants sur KLOSQUES PARTAGE.");
  const linked=await DB.prepare(
    "SELECT calendar_id,event_id FROM google_concert_links WHERE booking_id=?"
  ).bind(booking.id).first();
  if(linked&&linked.calendar_id!==calendar.id)
    throw Error("Le dossier est lié à un autre calendrier. Aucune migration automatique.");
  const id=linked?.event_id||eventId(booking.id);
  const endpoint="https://www.googleapis.com/calendar/v3/calendars/"+
    encodeURIComponent(calendar.id)+"/events";
  const url=endpoint+"/"+encodeURIComponent(id);
  const current=await googleRequest(url,token);
  if(!current.ok&&current.status!==404)
    throw Error("Lecture de l'événement Google refusée ("+current.status+").");
  if(current.ok&&!owned(current.body,booking.id))
    throw Error("L'événement Google n'appartient pas à cette demande.");
  if(removeEvent){
    if(current.ok){
      const deleted=await googleRequest(url,token,"DELETE");
      if(!deleted.ok&&deleted.status!==404)
        throw Error("Suppression Google refusée ("+deleted.status+").");
    }
    await DB.prepare("DELETE FROM google_concert_links WHERE booking_id=? AND calendar_id=?")
      .bind(booking.id,calendar.id).run();
    return{removed:true};
  }
  const status=LABELS[booking.status];
  const location=normalize(booking.location).slice(0,110);
  const title="Les Klosques — "+status+(location?" — "+location:"");
  const payload={
    summary:title.slice(0,150),
    location:normalize(booking.location).slice(0,180),
    description:status+" dans Klosques Manager. Référence interne : "+booking.id+
      ". Retrouvez le dossier et les informations du client dans Manager uniquement.",
    start:{date:booking.event_date},end:{date:nextDay(booking.event_date)},
    visibility:"private",
    // Une demande non confirmée ne doit PAS bloquer les disponibilités
    // du formulaire public. Le concert confirmé, lui, occupe la date.
    transparency:["confirme","termine"].includes(booking.status)?"opaque":"transparent",
    reminders:{useDefault:false},
    extendedProperties:{private:{klosquesBookingId:booking.id}}
  };
  let operation=current.ok
    ?await googleRequest(url,token,"PATCH",payload)
    :await googleRequest(endpoint+"?sendUpdates=none",token,"POST",{...payload,id});
  if(!operation.ok&&operation.status===409&&!current.ok){
    // L'événement a pu être créé juste avant une réponse réseau perdue.
    const existing=await googleRequest(url,token);
    if(existing.ok&&owned(existing.body,booking.id))
      operation=await googleRequest(url,token,"PATCH",payload);
  }
  if(!operation.ok)
    throw Error("Écriture Google refusée ("+operation.status+").");
  await DB.prepare(
    "INSERT INTO google_concert_links(booking_id,calendar_id,event_id) VALUES(?,?,?) "+
    "ON CONFLICT(booking_id) DO UPDATE SET calendar_id=excluded.calendar_id,"+
    "event_id=excluded.event_id,synced_at=datetime('now')"
  ).bind(booking.id,calendar.id,id).run();
  return{created:!current.ok,updated:current.ok};
}
