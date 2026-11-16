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
function conciseEvent(event,kind){
  const start=event.start?.date||dateParis(event.start?.dateTime);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start))return null;
  const isPrivate=event.visibility==="private";
  const ownEvent=typeof event.extendedProperties?.private?.klosquesBookingId==="string";
  const isUnavailable=kind==="unavailable";
  return {
    id:String(event.id||"").slice(0,200),
    date:start,
    // Les indisponibilités sont visibles sans divulguer les motifs personnels.
    title:isUnavailable?"Indisponible":
      isPrivate&&!ownEvent?"Événement privé":String(event.summary||"Événement Klosques").slice(0,150),
    location:isUnavailable||isPrivate&&!ownEvent?"":String(event.location||"").slice(0,180),
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
