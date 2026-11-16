import {authorize,respond} from "../../_lib/admin-auth.js";
import {monthBounds} from "../../_lib/google.js";
import {resolveKlosquesCalendars} from "../../_lib/klosques-calendars.js";
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
    availability:event.transparency==="transparent"?"free":"busy"
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
