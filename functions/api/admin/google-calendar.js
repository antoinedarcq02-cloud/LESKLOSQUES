import {authorize,respond} from "../../_lib/admin-auth.js";
import {monthBounds} from "../../_lib/google.js";
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
function conciseEvent(event){
  const start=event.start?.date||dateParis(event.start?.dateTime);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start))return null;
  const isPrivate=event.visibility==="private";
  const ownEvent=typeof event.extendedProperties?.private?.klosquesBookingId==="string";
  return {
    id:String(event.id||"").slice(0,200),
    date:start,
    title:isPrivate&&!ownEvent?"Événement privé":String(event.summary||"Événement Google").slice(0,150),
    location:isPrivate&&!ownEvent?"":String(event.location||"").slice(0,180),
    all_day:!!event.start?.date,
    own_event:ownEvent,
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
    const calId=String(context.env.GOOGLE_CALENDAR_ID||"primary");
    let pageToken="",pages=0,events=[];
    do{
      const q=new URLSearchParams({
        timeMin:start,timeMax:end,singleEvents:"true",orderBy:"startTime",
        maxResults:"100",timeZone:"Europe/Paris"
      });
      if(pageToken)q.set("pageToken",pageToken);
      const endpoint="https://www.googleapis.com/calendar/v3/calendars/"+
        encodeURIComponent(calId)+"/events?"+q.toString();
      const response=await fetch(endpoint,{headers:{Authorization:"Bearer "+token}});
      if(!response.ok)throw Error("Google Agenda refuse la lecture des événements (code "+response.status+").");
      const result=await response.json();
      for(const event of result.items||[]){
        if(event.status==="cancelled")continue;
        const safe=conciseEvent(event);
        if(safe)events.push(safe);
      }
      pageToken=result.nextPageToken||"";
      pages++;
    }while(pageToken&&pages<3);
    const {results}=await DB.prepare(
      "SELECT booking_id,calendar_id,event_id,synced_at FROM google_concert_links LIMIT 500"
    ).all();
    return respond({
      connected:true,month,events,links:(results||[]).filter(r=>r.calendar_id===calId),
      truncated:!!pageToken
    });
  }catch(error){
    console.warn("Lecture Google Agenda impossible",error?.message);
    return respond({error:"Google Agenda indisponible. Vérifie la connexion, les droits Calendar et le calendrier choisi."},503);
  }
}
