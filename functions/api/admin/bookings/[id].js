import { authorize, respond, cleanText, validDate, statuses } from "../../../../_lib/admin-auth.js";

const EDITABLE = {
  name: 150, email: 254, phone: 50, event_type: 100, event_date: 10,
  location: 200, package: 200, message: 2500, notes: 3000
};

export async function onRequestGet(context) {
  const user = await authorize(context);
  if (user.error) return user.error;
  const id = context.params.id;
  if (!/^[\da-f-]{36}$/.test(id || "")) return respond({ error: "Identifiant invalide." }, 400);
  const booking = await context.env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(id).first();
  return booking ? respond({ booking }) : respond({ error: "Dossier introuvable." }, 404);
}

export async function onRequestPatch(context) {
  const user = await authorize(context, true);
  if (user.error) return user.error;
  const id = context.params.id;
  if (!/^[\da-f-]{36}$/.test(id || "")) return respond({ error: "Identifiant invalide." }, 400);
  try {
    const raw = await context.request.text();
    if (raw.length > 16000) return respond({ error: "Dossier trop long." }, 413);
    const data = JSON.parse(raw);
    const updates = {};
    for (const [key, max] of Object.entries(EDITABLE)) {
      if (Object.prototype.hasOwnProperty.call(data, key)) updates[key] = cleanText(data[key], max);
    }
    if ("status" in data) {
      if (!statuses.includes(data.status)) return respond({ error: "Statut invalide." }, 400);
      updates.status = data.status;
    }
    if ("quote_amount_cents" in data) {
      const amount = data.quote_amount_cents;
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000000))
        return respond({ error: "Montant invalide." }, 400);
      updates.quote_amount_cents = amount;
    }
    if ("event_date" in updates && !validDate(updates.event_date))
      return respond({ error: "Date invalide." }, 400);
    if ("location" in updates && !updates.location) return respond({ error: "Le lieu est obligatoire." }, 400);
    if ("name" in updates && !updates.name) return respond({ error: "Un nom est obligatoire." }, 400);
    if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email))
      return respond({ error: "E-mail invalide." }, 400);
    if (Object.keys(updates).length === 0) return respond({ error: "Aucune modification fournie." }, 400);
    const fields = Object.keys(updates);
    const values = fields.map(key => updates[key]);
    const statement = "UPDATE bookings SET " + fields.map(key => key + "=?").join(", ") +
      ", updated_at=datetime('now'), updated_by=? WHERE id=?";
    const result = await context.env.DB.prepare(statement).bind(...values, user.email, id).run();
    if (!result.meta?.changes) return respond({ error: "Dossier introuvable." }, 404);
    const booking = await context.env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(id).first();
    return respond({ booking });
  } catch (error) {
    console.warn("Erreur modification concert", error?.message);
    return respond({ error: "Enregistrement impossible." }, 503);
  }
}
