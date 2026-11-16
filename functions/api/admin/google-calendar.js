import {authorize,respond} from "../../_lib/admin-auth.js";
import {monthBounds} from "../../_lib/google.js";
import {resolveKlosquesCalendars} from "../../_lib/klosques-calendars.js";
import {syncRequestToGoogle} from "../../_lib/booking-google-sync.js";
import {flushPendingGoogleRemovals} from "../../_lib/booking-google-removal.js";
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
    // Une suppression volontaire disparaît immédiatement de l'Agenda commun,
    // même si Google n'est pas encore accessible. La file D1 la retentera.
    const {results:pendingRemovals}=await DB.prepare(
      "SELECT booking_id FROM google_pending_removals LIMIT 1000"
    ).all();
    const pendingIds=new Set((pendingRemovals||[]).map(row=>row.booking_id));
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
          if(kind==="concerts"&&(
            waitingIds.has(event.extendedProperties?.private?.klosquesBookingId)||
            pendingIds.has(event.extendedProperties?.private?.klosquesBookingId)))continue;
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
      pending_google_removals:pendingIds.size,
      truncated
    });
  }catch(error){
    console.warn("Lecture Google Agenda impossible",error?.message);
    return respond({error:"Impossible de lire les deux agendas partagés Klosques. Vérifie leur présence dans le compte Google et reconnecte Google depuis Site si nécessaire."},503);
  }
}

// Événements orphelins des anciennes suppressions : ne nettoyer que ceux
// dont la description et le marqueur privé prouvent l'origine "demande site".
// Les concerts manuels, les événements indépendants et PAS DISPO sont exclus.
const SITE_LABELS=[
  "Demande à traiter","Demande en discussion","Devis envoyé",
  "Date en option","Concert confirmé","Concert terminé"
];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function cleanupOldDeletedSiteEvents(env){
  const DB=env.DB;
  const {results}=await DB.prepare(
    "SELECT l.booking_id,l.calendar_id,l.event_id FROM google_concert_links l "+
    "LEFT JOIN bookings b ON b.id=l.booking_id "+
    "WHERE b.id IS NULL AND NOT EXISTS("+
    "SELECT 1 FROM google_pending_removals q WHERE q.booking_id=l.booking_id) LIMIT 20"
  ).all();
  if(!results?.length)return{removed:0,failed:0};
  const connection=await getConnected(DB,"google");
  if(!connection&&!env.GOOGLE_REFRESH_TOKEN)return{removed:0,failed:results.length};
  const token=await providerAccessToken(env,"google");
  const calendars=await resolveKlosquesCalendars(env,token);
  const calendar=calendars.concerts;
  if(!["owner","writer","writerWithoutPrivateAccess"].includes(calendar.accessRole))
    return{removed:0,failed:results.length};
  let removed=0,failed=0;
  for(const link of results){
    if(!UUID.test(link.booking_id)||link.calendar_id!==calendar.id||!link.event_id)continue;
    const url="https://www.googleapis.com/calendar/v3/calendars/"+
      encodeURIComponent(calendar.id)+"/events/"+encodeURIComponent(link.event_id);
    try{
      const response=await fetch(url,{headers:{Authorization:"Bearer "+token}});
      if(response.status===404||response.status===410){
        // L'entrée Google n'existe plus, seule l'association D1 est obsolète.
        await DB.prepare(
          "DELETE FROM google_concert_links WHERE booking_id=? AND calendar_id=? AND event_id=?"
        ).bind(link.booking_id,calendar.id,link.event_id).run();
        continue;
      }
      if(!response.ok)throw Error("Lecture Google refusée ("+response.status+").");
      const item=await response.json();
      const proof=SITE_LABELS.some(label=>String(item.description||"").startsWith(
        label+" dans Klosques Manager. Référence interne : "+link.booking_id+"."
      ));
      if(item.extendedProperties?.private?.klosquesBookingId!==link.booking_id||
         !proof||!item.etag)continue;
      const deleted=await fetch(url+"?sendUpdates=none",{
        method:"DELETE",
        headers:{Authorization:"Bearer "+token,"If-Match":item.etag}
      });
      if(!deleted.ok&&deleted.status!==404&&deleted.status!==410)
        throw Error("Suppression Google refusée ("+deleted.status+").");
      await DB.prepare(
        "DELETE FROM google_concert_links WHERE booking_id=? AND calendar_id=? AND event_id=?"
      ).bind(link.booking_id,calendar.id,link.event_id).run();
      removed++;
    }catch(error){
      failed++;
      console.warn("Ancien événement de demande non nettoyé",error?.message);
    }
  }
  return{removed,failed};
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
    // Retenter les suppressions explicites restées en file après une coupure
    // de Google (ou une panne réseau), avant les anciens orphelins.
    const retry=await flushPendingGoogleRemovals(context.env,{limit:20});
    // Les anciennes associations sans dossier sont traitées seulement si
    // deux preuves indépendantes confirment l'origine "demande du site".
    const old=await cleanupOldDeletedSiteEvents(context.env);
    return respond({
      ok:true,processed:(results||[]).length,cleaned,
      orphaned_removed:old.removed,
      queued_removed:retry.removed+retry.already_absent,
      pending_google_removals:retry.pending,
      failed:failed+old.failed+retry.failed
    });
  }catch(error){
    console.warn("Rattrapage demandes Google impossible",error?.message);
    return respond({error:"Nettoyage des anciennes demandes indisponible. Tu peux toujours consulter les dossiers."},503);
  }
}
