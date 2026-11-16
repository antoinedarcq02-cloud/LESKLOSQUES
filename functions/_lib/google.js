import {providerAccessToken} from "./integrations.js";
import {resolveKlosquesCalendars} from "./klosques-calendars.js";

// Reutilise la connexion établie depuis Manager et, à défaut, l'ancien
// GOOGLE_REFRESH_TOKEN déjà présent dans les secrets Cloudflare.
export async function getGoogleAccessToken(env) {
  return providerAccessToken(env,"google");
}

export function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) throw new Error("Mois invalide.");
  const [year, mon] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, mon - 1, 1)).toISOString(),
    end: new Date(Date.UTC(year, mon, 1)).toISOString()
  };
}

function parisDate(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(iso));
}
function plusOneDay(date) {
  const [y,m,d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0,10);
}
export async function getBusyDates(env, timeMin, timeMax) {
  const token=await getGoogleAccessToken(env);
  // La disponibilité ne consulte QUE les deux agendas partagés du groupe.
  const calendars=await resolveKlosquesCalendars(env,token);
  const ids=[calendars.concerts.id,calendars.unavailable.id];
  const response=await fetch("https://www.googleapis.com/calendar/v3/freeBusy",{
    method:"POST",
    headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify({
      timeMin,timeMax,timeZone:"Europe/Paris",items:ids.map(id=>({id}))
    })
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error("La lecture des disponibilités du groupe a échoué.");
  const busyDays=new Set();
  for(const id of ids){
    const info=data.calendars?.[id];
    if(!info||info.errors?.length)throw Error("Un des agendas Klosques ne peut pas être consulté.");
    for(const period of info.busy||[]){
      const startTime=new Date(period.start),endTime=new Date(period.end);
      if(!Number.isFinite(startTime.getTime())||!Number.isFinite(endTime.getTime()))continue;
      let day=parisDate(period.start);
      const endDate=parisDate(period.end);
      const endAtParisMidnight=new Intl.DateTimeFormat("fr-FR",{
        timeZone:"Europe/Paris",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
      }).format(endTime)==="00:00";
      const lastDay=endAtParisMidnight?endDate:plusOneDay(endDate);
      let count=0;
      while(day<lastDay&&count++<370){
        busyDays.add(day);
        day=plusOneDay(day);
      }
    }
  }
  return [...busyDays].sort();
}
