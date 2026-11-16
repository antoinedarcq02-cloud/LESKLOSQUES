import {authorize,respond,validDate,cleanText} from "../../../_lib/admin-auth.js";
import {providerAccessToken} from "../../../_lib/integrations.js";
import {resolveKlosquesCalendars} from "../../../_lib/klosques-calendars.js";

// Création explicite d'un événement dans l'un des DEUX agendas partagés.
// La requête ne peut jamais fournir un identifiant Google arbitraire.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME=/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const EDIT_ROLES=new Set(["owner","writer","writerWithoutPrivateAccess"]);
const nameOf={concerts:"KLOSQUES PARTAGE",unavailable:"KLOSQUES PAS DISPO PARTAGE"};
function addDay(date){
  const parsed=new Date(date+"T12:00:00Z");
  parsed.setUTCDate(parsed.getUTCDate()+1);
  return parsed.toISOString().slice(0,10);
}
export async function onRequestPost(context){
  const user=await authorize(context,true);
  if(user.error)return user.error;
  // Les quatre musiciens authentifiés disposent des mêmes droits de création.
  // L'authentification et la protection same-origin restent obligatoires.
  if(!["admin","member"].includes(user.user?.role))
    return respond({error:"Création Google réservée aux comptes des musiciens."},403);
  let body;
  try{
    const raw=await context.request.text();
    if(raw.length>2800)return respond({error:"Formulaire trop long."},413);
    body=JSON.parse(raw);
  }catch{return respond({error:"Formulaire invalide."},400);}
  const kind=body?.calendar;
  const title=typeof body?.title==="string"?cleanText(body.title,151):"";
  const location=typeof body?.location==="string"?cleanText(body.location,181):"";
  const description=typeof body?.description==="string"?cleanText(body.description,1001):"";
  const start=body?.start_date,end=body?.end_date;
  const allDay=body?.all_day;
  if(body?.confirm!==true||!UUID.test(body?.request_id||""))
    return respond({error:"Création non confirmée."},400);
  if(!Object.hasOwn(nameOf,kind)||!title||title.length>150||
     location.length>180||description.length>1000)
    return respond({error:"Choisis un agenda partagé et un titre (150 caractères maximum)."},400);
  if(!validDate(start)||!validDate(end)||end<start||
     (Date.parse(end+"T12:00:00Z")-Date.parse(start+"T12:00:00Z"))/86400000>366)
    return respond({error:"Les dates sont invalides (durée maximale : 366 jours)."},400);
  if(typeof allDay!=="boolean")return respond({error:"Précise si l'événement dure toute la journée."},400);
  const startTime=body?.start_time,endTime=body?.end_time;
  if(!allDay&&(!TIME.test(startTime||"")||!TIME.test(endTime||"")||
     start+"T"+startTime>=end+"T"+endTime))
    return respond({error:"Vérifie les heures : la fin doit être après le début."},400);
  try{
    const token=await providerAccessToken(context.env,"google");
    const calendars=await resolveKlosquesCalendars(context.env,token);
    const selected=calendars[kind];
    if(!selected||!EDIT_ROLES.has(selected.accessRole))
      return respond({error:"Le compte Google n'a pas les droits d'écriture sur "+nameOf[kind]+". Vérifie le partage de cet agenda."},403);
    const id="klo"+body.request_id.replace(/-/g,"").toLowerCase();
    const url="https://www.googleapis.com/calendar/v3/calendars/"+
      encodeURIComponent(selected.id)+"/events";
    // Date de fin exclusive pour les événements 'toute la journée'.
    const startValue=allDay?{date:start}:{dateTime:start+"T"+startTime+":00",timeZone:"Europe/Paris"};
    const endValue=allDay?{date:addDay(end)}:{dateTime:end+"T"+endTime+":00",timeZone:"Europe/Paris"};
    const event={
      id,summary:title,location,description,start:startValue,end:endValue,
      transparency:"opaque",reminders:{useDefault:false},
      extendedProperties:{private:{klosquesManualEventId:body.request_id}}
    };
    const result=await fetch(url+"?sendUpdates=none",{
      method:"POST",
      headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify(event)
    });
    if(result.status===409){
      // Réponse d'une précédente tentative perdue : ne PAS créer un doublon.
      const check=await fetch(url+"/"+encodeURIComponent(id),{
        headers:{Authorization:"Bearer "+token}
      });
      if(check.ok){
        const existing=await check.json().catch(()=>({}));
        if(existing.extendedProperties?.private?.klosquesManualEventId===body.request_id)
          return respond({ok:true,already_exists:true,calendar:kind});
      }
      return respond({error:"Cet identifiant d'événement est déjà utilisé. Rien n'a été modifié."},409);
    }
    if(result.status===401||result.status===403)
      return respond({error:"Google refuse l'écriture. Reconnecte le compte et vérifie les autorisations de "+nameOf[kind]+"."},403);
    if(!result.ok)throw Error("Google Calendar events.insert a échoué : "+result.status);
    return respond({ok:true,created:true,calendar:kind},201);
  }catch(error){
    console.warn("Création d'événement Google impossible",error?.message);
    return respond({error:"Impossible de créer l'événement Google. Vérifie la connexion et les droits de partage puis réessaie."},503);
  }
}
