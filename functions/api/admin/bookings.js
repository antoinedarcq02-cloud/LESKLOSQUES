import { authorize, respond, cleanText, validDate, statuses } from "../../_lib/admin-auth.js";
import { ensureQuotesTable } from "../../_lib/quote-table.js";

export async function onRequestGet(context) {
  const user = await authorize(context);
  if (user.error) return user.error;
  try {
    // L'avancement du devis est dérivé des devis réellement liés à la demande.
    // 0 = aucun, 1 = brouillon, 2 = devis finalisé. Ne change jamais le statut
    // métier « Devis envoyé », qui ne doit pas être déduit d'un simple enregistrement.
    await ensureQuotesTable(context.env.DB);
    const { results } = await context.env.DB.prepare(`
      SELECT b.*,
        COALESCE((
          SELECT MAX(CASE q.status WHEN 'finalise' THEN 2 WHEN 'brouillon' THEN 1 ELSE 0 END)
          FROM official_quotes q WHERE q.booking_id = b.id
        ), 0) AS quote_progress
      FROM bookings b
      ORDER BY b.event_date DESC, b.created_at DESC LIMIT 500
    `).all();
    return respond({ bookings: results || [], email: user.email });
  } catch (error) {
    console.warn("Erreur liste concerts", error?.message);
    return respond({ error: "Impossible de consulter les dossiers. Vérifiez la migration D1." }, 503);
  }
}

export async function onRequestPost(context) {
  const user = await authorize(context, true);
  if (user.error) return user.error;
  try {
    const raw = await context.request.text();
    if (raw.length > 16000) return respond({ error: "Dossier trop long." }, 413);
    const data = JSON.parse(raw);
    const event_date = cleanText(data.event_date, 10);
    const location = cleanText(data.location, 200);
    const name = cleanText(data.name, 150) || "Concert";
    if (!validDate(event_date) || !location) return respond({ error: "La date et le lieu sont obligatoires." }, 400);
    const status = statuses.includes(data.status) ? data.status : "option";
    const fields = {
      id: crypto.randomUUID(),
      source: "manuel", name,
      email: cleanText(data.email, 254),
      phone: cleanText(data.phone, 50),
      event_type: cleanText(data.event_type, 100),
      event_date, location,
      package: cleanText(data.package, 200),
      message: cleanText(data.message, 2500),
      status, notes: cleanText(data.notes, 3000)
    };
    if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))
      return respond({ error: "Adresse e-mail invalide." }, 400);
    await context.env.DB.prepare(`INSERT INTO bookings
      (id,source,name,email,phone,event_type,event_date,location,package,message,status,notes,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(fields.id,fields.source,fields.name,fields.email,fields.phone,fields.event_type,
        fields.event_date,fields.location,fields.package,fields.message,fields.status,fields.notes,user.email).run();
    const item = await context.env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(fields.id).first();
    return respond({ booking: item }, 201);
  } catch (error) {
    console.warn("Erreur création concert", error?.message);
    return respond({ error: "Enregistrement impossible." }, 503);
  }
}
