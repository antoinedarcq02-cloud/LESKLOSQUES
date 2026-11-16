import {authorize,respond} from "../../_lib/admin-auth.js";
import {monthBounds} from "../../_lib/google.js";
import {resolveKlosquesCalendars} from "../../_lib/klosques-calendars.js";
import {syncRequestToGoogle} from "../../_lib/booking-google-sync.js";
import {
  ensureIntegrationTables,getConnected,providerAccessToken
} from "../../_lib/integrations.js";

function dateParis(value){
  if(typeof value!=="string")return "";
  const time=new Date(value);
  if(Number.isNaN(time.getTime()))return "";
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(time);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return p.year+"-"+p.month+"-"+p.day;
}
function nextDay(date){
  const d=new Date(date+"T12:00:00Z");
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
}
// Google fournit une fin exclusive pour les événements sur la journée.
// Pour les horaires, convertir la fin à l'heure locale Paris et inclure
// le dernier jour sauf si la fin est exactement à minuit.
function endExclusive(event,start){
  const end=event.end;
  if(/^\d{4}-\d{2}-\d{2}$/.test(end?.date||""))
    return end.date>start?end.date:nextDay(start);
  if(end?.dateTime){
    const date=dateParis(end.dateTime);
    const time=new Date(end.dateTime);
    if(date&&!Number.isNaN(time.getTime())){
      const fields=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
        timeZone:"Europe/Paris",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"
      }).formatToParts(time).map(p=>[p.type,p.value]));
      const midnight=fields.hour==="00"&&fields.minute==="00"&&fields.second==="00";
      const exclusive=midnight?date:nextDay(date);
      if(exclusive>start)return exclusive;
    }
  }
  return nextDay(start);
}
function conciseEvent(event,kind){
  const start=event.start?.date||dateParis(event.start?.dateTime);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start))return null;
  const isPrivate=event.visibility==="private";
  const ownEvent=typeof event.extendedProperties?.private?.klosquesBookingId==="string";
  const isUnavailable=kind==="unavailable";
  return {
    id:String(event.id||"").slice(0,200),
    date:start,
    end_date:endExclusive(event,start),
    // Le groupe souhaite voir le libellé original des deux agendas partagés.
    // Si Google masque un événement privé, respecter le libellé qu'il renvoie.
    title:String(event.summary||(isPrivate?"Événement privé":"Sans titre")).slice(0,150),
    // Le titre suffit dans le calendrier des indisponibilités.
    location:isUnavailable?"":String(event.location||"").slice(0,180),
    calendar:kind,
    calendar_name:isUnavailable?"KLOSQUES PAS DISPO PARTAGE":"KLOSQUES PARTAGE",
    all_day:!!event.start?.date,
    own_event:ownEvent&&!isUnavailable,
    availability:event.transparency==="transparent"?"free":"busy",
    etag:String(event.etag||"").slice(0,200)
  };
}
export async function onRequestGet(context){
  const user=await authorize(context);
  if(user.error)return user.error;
  let month,start,end;
  try{
    month=new URL(context.request.url).searchParams.get("month");
    ({start,end}=monthBounds(month));
  }catch{return respond({error:"Mois invalide."},400);}
  try{
    const DB=context.env.DB;
    await ensureIntegrationTables(DB);
    const connection=await getConnected(DB,"google");
    if(!connection&&!context.env.GOOGLE_REFRESH_TOKEN)
      return respond({connected:false,month,events:[],links:[]});
    const token=await providerAccessToken(context.env,"google");
    // Identifier les deux calendriers de groupe par leurs noms exacts.
    // Aucun événement de l'agenda personnel "primary" n'est lu.
    const calendars=await resolveKlosquesCalendars(context.env,token);
    // Masquer immédiatement les anciennes demandes encore en attente,
    // même si leur événement Google historique n'a pas encore été nettoyé.
    // Seul un marqueur privé de dossier du site est concerné : les
    // événements ajoutés directement par les musiciens restent visibles.
    const {results:waiting}=await DB.prepare(
      "SELECT id FROM bookings WHERE source='site' AND status='nouveau'"
    ).all();
    const waitingIds=new Set((waiting||[]).map(row=>row.id));
    let events=[],truncated=false;
    for(const [kind,calendar] of Object.entries(calendars)){
      let pageToken="",pages=0;
      do{
        const q=new URLSearchParams({
          timeMin:start,timeMax:end,singleEvents:"true",orderBy:"startTime",
          maxResults:"100",timeZone:"Europe/Paris"
        });
        if(pageToken)q.set("pageToken",pageToken);
        const endpoint="https://www.googleapis.com/calendar/v3/calendars/"+
          encodeURIComponent(calendar.id)+"/events?"+q.toString();
        const response=await fetch(endpoint,{headers:{Authorization:"Bearer "+token}});
        if(!response.ok)throw Error("Lecture de "+calendar.name+" refusée (code "+response.status+").");
        const result=await response.json().catch(()=>({}));
        for(const event of result.items||[]){
          if(event.status==="cancelled")continue;
          if(kind==="concerts"&&waitingIds.has(
            event.extendedProperties?.private?.klosquesBookingId))continue;
          const safe=conciseEvent(event,kind);
          if(safe)events.push(safe);
        }
        pageToken=result.nextPageToken||"";
        pages++;
      }while(pageToken&&pages<3);
      if(pageToken)truncated=true;
    }
    events.sort((a,b)=>a.date.localeCompare(b.date)||a.calendar.localeCompare(b.calendar));
    const {results}=await DB.prepare(
      "SELECT booking_id,calendar_id,event_id,synced_at FROM google_concert_links LIMIT 500"
    ).all();
    return respond({
      connected:true,month,events,
      calendars:{concerts:calendars.concerts.name,unavailable:calendars.unavailable.name},
      links:(results||[]).filter(r=>r.calendar_id===calendars.concerts.id),
      truncated
    });
  }catch(error){
    console.warn("Lecture Google Agenda impossible",error?.message);
    return respond({error:"Impossible de lire les deux agendas partagés Klosques. Vérifie leur présence dans le compte Google et reconnecte Google depuis Site si nécessaire."},503);
  }
}

/**
 * Rattrapage sûr des anciennes demandes "nouveau" déjà publiées.
 * Déclenché par l'Agenda commun d'un musicien connecté. Seules les
 * associations connues dans D1 sont parcourues. La fonction de synchronisation
 * relit le statut courant et vérifie le marqueur privé Google avant d'effacer.
 * Aucun événement des agendas personnels ou PAS DISPO n'est modifié.
 */
export async function onRequestPost(context){
  const user=await authorize(context,true);
  if(user.error)return user.error;
  if(!["admin","member"].includes(user.user?.role))
    return respond({error:"Action réservée aux comptes des musiciens."},403);
  let body;
  try{
    const raw=await context.request.text();
    if(raw.length>200)return respond({error:"Requête trop longue."},413);
    body=JSON.parse(raw);
  }catch{return respond({error:"Requête invalide."},400);}
  if(body?.action!=="cleanup_waiting_requests"||body?.confirm!==true)
    return respond({error:"Action non confirmée."},400);
  try{
    await ensureIntegrationTables(context.env.DB);
    const {results}=await context.env.DB.prepare(
      "SELECT b.id,b.source,b.status,b.event_date,b.location FROM bookings b "+
      "JOIN google_concert_links l ON l.booking_id=b.id "+
      "WHERE b.source='site' AND b.status='nouveau' LIMIT 20"
    ).all();
    let cleaned=0,failed=0;
    // Volume limité par consultation pour ne pas saturer Google Calendar.
    // La fonction recontrôle le statut ; si la demande a progressé depuis
    // notre SELECT elle est mise à jour, pas supprimée.
    for(let i=0;i<(results||[]).length;i+=4){
      const group=results.slice(i,i+4);
      const outcomes=await Promise.allSettled(
        group.map(booking=>syncRequestToGoogle(context.env,booking))
      );
      for(const outcome of outcomes){
        if(outcome.status==="fulfilled"&&!outcome.value?.skipped)cleaned++;
        else if(outcome.status==="rejected"){
          failed++;
          console.warn("Nettoyage demande Google impossible",outcome.reason?.message);
        }
      }
    }
    return respond({ok:true,processed:(results||[]).length,cleaned,failed});
  }catch(error){
    console.warn("Rattrapage demandes Google impossible",error?.message);
    return respond({error:"Nettoyage des anciennes demandes indisponible. Tu peux toujours consulter les dossiers."},503);
  }
}
