import { getBusyDates } from "../_lib/google.js";

// Destination unique des demandes : les coordonnées des visiteurs ne sont
// envoyées que lorsque ceux-ci valident le formulaire.
const DESTINATION = "LesKlosques@hotmail.com";
const ALLOWED_PACKAGES = new Set([
  "Formule auto gestion (sans DJ)",
  "Formule Auto gestion + DJ",
  "Prestation du groupe Les Klosques avec équipe technique",
  "Prestation du groupe Les Klosques avec équipe technique + DJ",
  "Prestation du groupe Les Klosques avec remorque"
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
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      return Response.json({ error: "L'envoi des devis n'est pas encore configuré. Contactez directement le groupe par e-mail." }, { status: 503 });
    }
    // Limite raisonnable : évite de traiter de très gros messages.
    if (Number(request.headers.get("content-length") || 0) > 16000) {
      return Response.json({ error: "Le formulaire est trop long." }, { status: 413 });
    }
    const data = await request.json();
    if (clean(data.website)) return Response.json({ ok: true }); // champ anti-spam invisible

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
    const todayParis = `${dayParts.year}-${dayParts.month}-${dayParts.day}`;

    if (!name || !phone || !location || !validCalendarDate(date) || date < todayParis ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !ALLOWED_PACKAGES.has(pkg) || !ALLOWED_EVENT_TYPES.has(eventType)) {
      return Response.json({ error: "Merci de vérifier la prestation, la date et les coordonnées obligatoires." }, { status: 400 });
    }

    // La demande de devis peut être reçue même si Google Agenda est momentanément
    // inaccessible : dans ce cas le groupe vérifiera la date manuellement.
    let availability = "À vérifier manuellement";
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN) {
      try {
        const start = new Date(Date.parse(`${date}T00:00:00Z`) - 24 * 60 * 60 * 1000).toISOString();
        const end = new Date(Date.parse(`${date}T00:00:00Z`) + 48 * 60 * 60 * 1000).toISOString();
        const busy = await getBusyDates(env, start, end);
        if (busy.includes(date)) {
          return Response.json({ error: "Cette date apparaît occupée dans notre agenda. Choisissez une autre date ou contactez-nous." }, { status: 409 });
        }
        availability = "Aucune indisponibilité détectée (à confirmer par le groupe)";
      } catch (err) {
        console.warn("Google Agenda : vérification de date indisponible", err?.message || err);
      }
    }

    const lines = [
      "NOUVELLE DEMANDE DE DEVIS — LES KLOSQUES", "",
      `Prestation demandée : ${pkg}`,
      `Type d'événement : ${eventType}`,
      `Date souhaitée : ${date}`,
      `Lieu : ${location}`,
      `Disponibilité : ${availability}`, "",
      `Nom / organisation : ${name}`,
      `E-mail : ${email}`,
      `Téléphone : ${phone}`, "",
      "Informations complémentaires :", message || "Aucune précision", "",
      "ACTION REQUISE : étudier et valider le devis avant de l'envoyer au client.",
      "Ceci n'est ni un devis accepté, ni une réservation confirmée.",
      "Aucun e-mail de devis n'est envoyé automatiquement au client."
    ];

    const mail = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [DESTINATION],
        reply_to: email,
        subject: `Demande de devis Les Klosques — ${date}`,
        text: lines.join("\n")
      })
    });
    if (!mail.ok) {
      console.warn("Resend : échec de l'envoi de devis", mail.status);
      return Response.json({ error: "Le service d'e-mail a refusé l'envoi. Contactez directement le groupe par e-mail." }, { status: 502 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.warn("Erreur formulaire de devis", error?.message || error);
    return Response.json({ error: "Une erreur est survenue. Contactez-nous directement par e-mail." }, { status: 503 });
  }
}
