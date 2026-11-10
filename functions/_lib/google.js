export async function getGoogleAccessToken(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new Error("Google Agenda n'est pas encore configuré.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("Impossible d'accéder à Google Agenda.");
  return data.access_token;
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
  const token = await getGoogleAccessToken(env);
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin, timeMax, timeZone: "Europe/Paris",
      items: [{ id: env.GOOGLE_CALENDAR_ID || "primary" }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error("La lecture des disponibilités Google a échoué.");
  const calendarId = env.GOOGLE_CALENDAR_ID || "primary";
  const periods = data.calendars?.[calendarId]?.busy || [];
  const days = new Set();
  for (const period of periods) {
    let day = parisDate(period.start);
    const endDate = parisDate(period.end);
    const endAtParisMidnight = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).format(new Date(period.end)) === "00:00";
    const lastDay = endAtParisMidnight ? endDate : plusOneDay(endDate);
    while (day < lastDay) {
      days.add(day);
      day = plusOneDay(day);
    }
  }
  return [...days].sort();
}
