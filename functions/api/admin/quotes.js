import { authorize, respond, cleanText, validDate } from "../../_lib/admin-auth.js";
import { ensureQuotesTable } from "../../_lib/quote-table.js";

// Devis enregistrés dans D1 : création de la table lors du premier accès authentifié.
// Le numéro est basé sur la clé primaire croissante ; une fois finalisé, le devis n'est plus modifiable.
const PROFILE_KEY = "quote_issuer_profile";
const TEXT = {
  issuer_name: 160, issuer_address: 350, issuer_identifier: 90, issuer_tax_number: 70,
  issuer_contact: 180, issuer_legal: 250,
  client_name: 160, client_address: 350, client_email: 254,
  event_date: 10, event_time: 5, event_location: 240,
  issue_date: 10, valid_until: 10, payment_terms: 600,
  description: 900, conditions: 1400
};
const ISSUER = ["issuer_name","issuer_address","issuer_identifier","issuer_tax_number","issuer_contact","issuer_legal"];
const VAT_MODES = ["non_precise","franchise","20","10","5.5","0"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Informations du devis invalides.");
  const data = {};
  for (const [key, max] of Object.entries(TEXT)) {
    if (raw[key] != null && typeof raw[key] !== "string")
      throw new Error("Format de champ incorrect : " + key);
    data[key] = cleanText(raw[key], max);
  }
  if (!VAT_MODES.includes(raw.vat_mode))
    throw new Error("Choisis le régime de TVA applicable.");
  data.vat_mode = raw.vat_mode;
  if (data.client_email && !EMAIL.test(data.client_email))
    throw new Error("Adresse e-mail du client incorrecte.");
  for (const key of ["event_date","issue_date","valid_until"]) {
    if (data[key] && !validDate(data[key])) throw new Error("Date invalide : " + key);
  }
  if (data.event_time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.event_time))
    throw new Error("Heure de prestation invalide.");
  if (!Array.isArray(raw.lines) || raw.lines.length > 12)
    throw new Error("Prévois 12 lignes de prestation au maximum.");
  data.lines = raw.lines.map((line) => {
    if (!line || typeof line !== "object" || typeof line.label !== "string" ||
        !Number.isFinite(line.qty) || line.qty <= 0 || line.qty > 1000 ||
        !Number.isSafeInteger(line.price_cents) || line.price_cents < 0 ||
        line.price_cents > 100000000)
      throw new Error("Vérifie la quantité et le prix des prestations.");
    return {
      label: cleanText(line.label, 220),
      qty: line.qty,
      price_cents: line.price_cents
    };
  });
  const totalCents = data.lines.reduce((total, line) =>
    total + Math.round(line.qty * line.price_cents), 0);
  if (!Number.isSafeInteger(totalCents) || totalCents > 100000000)
    throw new Error("Le montant total dépasse la limite autorisée.");
  return data;
}
function ensureFinalizable(data) {
  if (data.vat_mode === "non_precise")
    throw new Error("Choisis le régime de TVA applicable avant de finaliser.");
  const required = {
    issuer_name:"le nom de la structure émettrice", issuer_address:"son adresse",
    issuer_identifier:"son identifiant officiel (SIRET, RNA ou autre)",
    client_name:"le nom du client", client_address:"l'adresse du client",
    issue_date:"la date du devis", valid_until:"la date limite de validité",
    event_date:"la date de la prestation", event_location:"le lieu de la prestation",
    payment_terms:"les modalités de paiement"
  };
  for (const [key,label] of Object.entries(required))
    if (!data[key]) throw new Error("Renseigne " + label + " avant de finaliser.");
  if (data.valid_until < data.issue_date)
    throw new Error("La validité doit se terminer après la date d'émission.");
  if (!data.lines.length || data.lines.some((line) => !line.label || line.price_cents <= 0))
    throw new Error("Renseigne la description, la quantité et le prix de chaque prestation.");
}

function cleanRow(row) {
  if (!row) return null;
  const data = JSON.parse(row.data_json);
  return {
    id: row.id,
    number: "DEV-" + row.created_at.slice(0,4) + "-" + String(row.id).padStart(5, "0"),
    status: row.status,
    booking_id: row.booking_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    data
  };
}

export async function onRequestGet(context) {
  const user = await authorize(context);
  if (user.error) return user.error;
  try {
    await ensureQuotesTable(context.env.DB);
    const [rows, profile] = await Promise.all([
      context.env.DB.prepare("SELECT * FROM official_quotes ORDER BY id DESC LIMIT 200").all(),
      context.env.DB.prepare("SELECT value FROM site_content WHERE key=?").bind(PROFILE_KEY).first()
    ]);
    let issuer = {};
    if (profile?.value) {
      try { issuer = JSON.parse(profile.value); } catch { issuer = {}; }
    }
    return respond({ quotes:(rows.results || []).map(cleanRow), issuer });
  } catch (error) {
    console.warn("Erreur chargement devis", error?.message);
    return respond({ error:"Impossible d'accéder aux devis dans la base D1." }, 503);
  }
}
export async function onRequestPost(context) {
  const user = await authorize(context, true);
  if (user.error) return user.error;
  try {
    const raw = await context.request.text();
    if (raw.length > 32000) return respond({ error:"Le devis est trop volumineux." }, 413);
    const body = JSON.parse(raw);
    if (body.action === "profile") {
      const issuer = {};
      for (const field of ISSUER) {
        if (body.data?.[field] != null && typeof body.data[field] !== "string")
          return respond({ error:"Coordonnées de la structure invalides." }, 400);
        issuer[field] = cleanText(body.data?.[field], TEXT[field]);
      }
      await context.env.DB.prepare(`INSERT INTO site_content (key,value,updated_by)
        VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,updated_by=excluded.updated_by,
        updated_at=datetime('now')`)
        .bind(PROFILE_KEY,JSON.stringify(issuer),user.email).run();
      return respond({ ok:true, issuer });
    }
    if (body.action !== "save" && body.action !== "finalize")
      return respond({ error:"Action de devis inconnue." }, 400);
    const data = normalize(body.data);
    const final = body.action === "finalize";
    if (final) ensureFinalizable(data);
    const booking = body.booking_id == null || body.booking_id === "" ? null : body.booking_id;
    if (booking !== null && (typeof booking !== "string" || !/^[\da-f-]{36}$/.test(booking)))
      return respond({ error:"Dossier client invalide." }, 400);
    await ensureQuotesTable(context.env.DB);
    let id = body.id;
    if (id != null) {
      if (!Number.isSafeInteger(id) || id < 1)
        return respond({ error:"Identifiant du devis invalide." }, 400);
      const result = await context.env.DB.prepare(
        "UPDATE official_quotes SET data_json=?, booking_id=?, status=?, updated_at=datetime('now'), updated_by=? WHERE id=? AND status='brouillon'"
      ).bind(JSON.stringify(data),booking,final ? "finalise" : "brouillon",user.email,id).run();
      if (!result.meta?.changes)
        return respond({ error:"Devis introuvable ou déjà finalisé : ses mentions sont verrouillées." }, 409);
    } else {
      const result = await context.env.DB.prepare(
        "INSERT INTO official_quotes (booking_id,data_json,status,updated_by) VALUES (?,?,?,?)"
      ).bind(booking,JSON.stringify(data),final ? "finalise" : "brouillon",user.email).run();
      id = Number(result.meta?.last_row_id);
      if (!Number.isSafeInteger(id) || id < 1)
        throw new Error("Identifiant de devis non renvoyé par D1");
    }
    const record = await context.env.DB.prepare("SELECT * FROM official_quotes WHERE id=?").bind(id).first();
    return respond({ quote:cleanRow(record) }, body.id == null ? 201 : 200);
  } catch (error) {
    if (error instanceof SyntaxError)
      return respond({ error:"Données du devis illisibles." }, 400);
    if (/^(Informations|Format de champ|Choisis|Adresse e-mail|Date invalide|Heure|Prévois|Vérifie|Le montant|Renseigne|La validité)/.test(error?.message || ""))
      return respond({ error:error.message }, 400);
    console.warn("Erreur sauvegarde devis", error?.message);
    return respond({ error:"Impossible d'enregistrer le devis." }, 503);
  }
}
