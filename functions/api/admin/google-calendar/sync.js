import {authorize,respond,validDate} from "../../../_lib/admin-auth.js";
import {ensureIntegrationTables,providerAccessToken} from "../../../_lib/integrations.js";
import {resolveKlosquesCalendars} from "../../../_lib/klosques-calendars.js";

const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const calendarEndpoint=(cal,id="")=>"https://www.googleapis.com/calendar/v3/calendars/"+
  encodeURIComponent(cal)+"/events"+(id?"/"+encodeURIComponent(id):"");
const nextDay=date=>{
  const d=new Date(date+"T12:00:00Z");
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
};
async function eventRequest(url,token,method="GET",body){
  const headers={Authorization:"Bearer "+token};
  if(body)headers["Content-Type"]="application/json";
  const response=await fetch(url,{method,headers,body:body?JSON.stringify(body):undefined});
  let data={};
  if(response.status!==204)data=await response.json().catch(()=>({}));
  return{ok:response.ok,status:response.status,data};
}
export async function onRequestPost(context){
  const user=await authorize(context,true);
  if(user.error)return user.error;
  if(user.user?.role!=="admin")
    return respond({error:"Synchronisation Google réservée au responsable."},403);
  let payload;
  try{
    const raw=await context.request.text();
    if(raw.length>500)return respond({error:"Requête trop longue."},413);
    payload=JSON.parse(raw);
  }catch{return respond({error:"Requête invalide."},400);}
  const id=payload?.booking_id;
  if(!UUID.test(id||"")||!["publish","remove"].includes(payload?.action)||payload?.confirm!==true)
    return respond({error:"Action de synchronisation non confirmée."},400);
  try{
    const DB=context.env.DB;
    await ensureIntegrationTables(DB);
    // Écrire UNIQUEMENT dans KLOSQUES PARTAGE, jamais dans l'agenda
    // personnel ni dans le calendrier des indisponibilités.
    const token=await providerAccessToken(context.env,"google");
    const calendars=await resolveKlosquesCalendars(context.env,token);
    const cal=calendars.concerts.id;
    if(!["owner","writer","writerWithoutPrivateAccess"].includes(calendars.concerts.accessRole))
      return respond({error:"Le compte Google ne peut pas modifier KLOSQUES PARTAGE. Vérifie le partage du calendrier."},403);
    const linked=await DB.prepare("SELECT calendar_id,event_id FROM google_concert_links WHERE booking_id=?")
      .bind(id).first();
    if(linked&&linked.calendar_id!==cal)
      return respond({error:"Ce concert est associé à un ancien calendrier différent de KLOSQUES PARTAGE. Il n'a pas été déplacé automatiquement."},409);
    if(payload.action==="remove"&&!linked)
      return respond({error:"Ce concert n'est pas associé à un événement publié par Manager."},404);
    const booking=payload.action==="publish"?
      await DB.prepare("SELECT id,name,location,event_date,status,source FROM bookings WHERE id=?").bind(id).first():null;
    if(payload.action==="publish"&&(!booking||booking.status!=="confirme"||!validDate(booking.event_date)))
      return respond({error:"Seuls les concerts confirmés et datés peuvent être ajoutés dans Google Agenda."},409);
    // IDs déterministes valides en base32hex, sans doublon en cas de réponse réseau perdue.
    const eventId=linked?.event_id||"klo"+id.replace(/-/g,"").toLowerCase();
    const url=calendarEndpoint(cal,eventId);
    const current=await eventRequest(url,token);
    if(!current.ok&&current.status!==404)
      throw Error("Lecture Google refusée "+current.status);
    if(current.ok&&current.data?.extendedProperties?.private?.klosquesBookingId!==id)
      return respond({error:"L'événement Google existant n'appartient pas à Klosques Manager. Aucune modification effectuée."},409);
    if(payload.action==="remove"){
      if(current.ok){
        const removed=await eventRequest(url,token,"DELETE");
        if(!removed.ok&&removed.status!==404)throw Error("Suppression Google refusée "+removed.status);
      }
      // Un retrait manuel d'une demande du site doit empêcher sa recréation.
      const origin=await DB.prepare("SELECT source FROM bookings WHERE id=?").bind(id).first();
      if(origin?.source==="site")
        await DB.prepare("INSERT OR IGNORE INTO google_event_optouts(booking_id) VALUES(?)").bind(id).run();
      await DB.prepare("DELETE FROM google_concert_links WHERE booking_id=? AND calendar_id=?")
        .bind(id,cal).run();
      return respond({ok:true,action:"removed"});
    }
    const data={
      summary:"Les Klosques — "+String(booking.location||"Concert").slice(0,110),
      location:String(booking.location||"").slice(0,200),
      description:"Concert confirmé Les Klosques. Référence du dossier Manager : "+id,
      start:{date:booking.event_date},end:{date:nextDay(booking.event_date)},
      visibility:"private",
      extendedProperties:{private:{klosquesBookingId:id}}
    };
    const operation=current.ok?
      await eventRequest(url,token,"PATCH",data):
      await eventRequest(calendarEndpoint(cal),token,"POST",{...data,id:eventId});
    if(!operation.ok){
      if(operation.status===409)
        return respond({error:"L'événement Google vient d'être créé. Actualise puis réessaie, pour éviter un doublon."},409);
      throw Error("Écriture Google refusée "+operation.status);
    }
    // Une republication manuelle explicite réactive la synchronisation du dossier.
    await DB.prepare("DELETE FROM google_event_optouts WHERE booking_id=?").bind(id).run();
    await DB.prepare(
      "INSERT INTO google_concert_links(booking_id,calendar_id,event_id) VALUES(?,?,?) ON CONFLICT(booking_id) DO UPDATE SET calendar_id=excluded.calendar_id,event_id=excluded.event_id,synced_at=datetime('now')"
    ).bind(id,cal,eventId).run();
    return respond({ok:true,action:current.ok?"updated":"created"});
  }catch(error){
    console.warn("Synchronisation concert Google échouée",error?.message);
    return respond({error:"Google Agenda n'a pas pu être mis à jour. Vérifie la connexion et les droits puis réessaie."},503);
  }
}
