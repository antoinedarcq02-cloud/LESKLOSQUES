import { getBusyDates } from "../_lib/google.js";

const DESTINATION = "LesKlosques@hotmail.com";
const ALLOWED_PACKAGES = [
  "Formule auto gestion (sans DJ)",
  "Formule Auto gestion + DJ",
  "Prestation du groupe Les Klosques avec équipe technique"
];
const clean = value => String(value || "").trim().slice(0, 3000);

export async function onRequestPost({ request, env }) {
  try {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      return Response.json({ error: "L'envoi des e-mails n'est pas encore configuré." }, { status: 503 });
    }
    const data = await request.json();
    if (clean(data.website)) return Response.json({ ok: true });
    const name = clean(data.name), email = clean(data.email), phone = clean(data.phone);
    const location = clean(data.location), date = clean(data.date), pkg = clean(data.package);
    const message = clean(data.message);
    if (!name || !location || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !ALLOWED_PACKAGES.includes(pkg)) {
      return Response.json({ error: "Merci de vérifier les champs obligatoires du formulaire." }, { status: 400 });
    }
    const start = new Date(`${date}T00:00:00+01:00`).toISOString();
    const end = new Date(Date.parse(start) + 36 * 60 * 60 * 1000).toISOString();
    const busy = await getBusyDates(env, start, end);
    if (busy.includes(date)) {
      return Response.json({ error: "Cette date apparaît déjà occupée dans l’agenda du groupe. Choisissez une autre date." }, { status: 409 });
    }
    const lines = [
      "Nouvelle demande de réservation — Les Klosques", "",
      `Nom / organisation : ${name}`, `E-mail : ${email}`, `Téléphone : ${phone || "Non renseigné"}`,
      `Lieu : ${location}`, `Date souhaitée : ${date}`, `Formule : ${pkg}`, "",
      "Message :", message || "Aucun message", "",
      "Cette demande est en attente de validation et ne constitue pas une réservation confirmée."
    ];
    const mail = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [DESTINATION],
        reply_to: email,
        subject: `Demande de réservation Les Klosques — ${date}`,
        text: lines.join("\n")
      })
    });
    if (!mail.ok) return Response.json({ error: "Le service d’e-mail a refusé l’envoi. Réessayez plus tard ou contactez-nous par e-mail." }, { status: 502 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message || "Une erreur est survenue." }, { status: 503 });
  }
}
