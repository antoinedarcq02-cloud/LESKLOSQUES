import { getBusyDates } from "../_lib/google.js";
import { rateLimit } from "../_lib/admin-auth.js";

// Les demandes arrivent d'abord dans D1 / Klosques Manager.
// L'envoi d'un email pourra être ajouté plus tard, indépendamment du stockage.
const ALLOWED_PACKAGES = new Set([
  "Formule auto gestion (sans DJ)",
  "Formule Auto gestion + DJ",
  "Équipe technique (sans DJ)",
  "Équipe technique + DJ",
  "Remorque autonome"
]);
const ALLOWED_EVENT_TYPES = new Set([
  "Mariage",
  "Fête de village / associative",
  "Événement privé",
  "Événement d'entreprise",
  "Festival / événement public",
  "Autre"
]);
const clean = (value, limit = 3000) =>
  String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + "T12:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

const errorResponse = (error, status) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB)
      return errorResponse("Le service des demandes est momentanément indisponible. Contactez directement le groupe par e-mail.", 503);

    // Écarter les requêtes lancées par un autre site.
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin)
      return errorResponse("Origine non autorisée.", 403);

    // Un Content-Length absent n'autorise pas un formulaire démesuré.
    if (Number(request.headers.get("content-length") || 0) > 16000)
      return errorResponse("Le formulaire est trop long.", 413);
    const raw = await request.text();
    if (raw.length > 16000)
      return errorResponse("Le formulaire est trop long.", 413);
    let data;
    try { data = JSON.parse(raw); }
    catch { return errorResponse("Le formulaire est invalide.", 400); }
    if (!data || typeof data !== "object" || Array.isArray(data))
      return errorResponse("Le formulaire est invalide.", 400);

    if (clean(data.website)) return Response.json({ ok: true }); // piège à robots

    const name = clean(data.name, 150);
    const email = clean(data.email, 254);
    const phone = clean(data.phone, 50);
    const location = clean(data.location, 200);
    const date = clean(data.date, 12);
    const pkg = clean(data.package, 200);
    const eventType = clean(data.eventType, 100);
    const message = clean(data.message, 2500);
    const parts = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const dayParts = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const todayParis = dayParts.year + "-" + dayParts.month + "-" + dayParts.day;

    if (!name || !phone || !location || !validCalendarDate(date) || date < todayParis ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !ALLOWED_PACKAGES.has(pkg) || !ALLOWED_EVENT_TYPES.has(eventType))
      return errorResponse("Merci de vérifier la prestation, la date et les coordonnées obligatoires.", 400);

    // L'agenda reste facultatif : un incident Google ne bloque pas les devis.
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN) {
      try {
        const start = new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString();
        const end = new Date(Date.parse(date + "T00:00:00Z") + 172800000).toISOString();
        const busy = await getBusyDates(env, start, end);
        if (busy.includes(date))
          return errorResponse("Cette date apparaît occupée dans notre agenda. Choisissez une autre date ou contactez-nous.", 409);
      } catch (error) {
        console.warn("Google Agenda : vérification de date indisponible", error?.message || error);
      }
    }

    // Éviter que le formulaire public soit utilisé pour saturer le Manager.
    if (env.ADMIN_SESSION_SECRET) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (!(await rateLimit(env, "quote-request:" + ip, 6)))
        return errorResponse("Trop de demandes en peu de temps. Merci de réessayer dans 15 minutes.", 429);
    }

    const inserted = await env.DB.prepare(`INSERT INTO bookings
      (id,source,name,email,phone,event_type,event_date,location,package,message,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,'nouveau')`)
      .bind(crypto.randomUUID(), "site", name, email, phone, eventType, date, location, pkg, message).run();
    // Ne confirmer au client qu'une demande réellement enregistrée.
    if (!inserted.success || Number(inserted.meta?.changes) !== 1)
      throw new Error("D1 : insertion non confirmée.");
    return Response.json({ ok: true, saved: true }, {
      status: 201, headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.warn("Erreur enregistrement demande de devis", error?.message || error);
    return errorResponse("La demande n'a pas pu être enregistrée. Réessayez ou contactez directement le groupe par e-mail.", 503);
  }
}
