import { authorize, respond, cleanText } from "../../_lib/admin-auth.js";

const TEXT_FIELDS = { hero_lead: 180, hero_copy: 500, intro_text: 650 };
const VIDEO_FIELDS = ["video_1", "video_2", "video_3"];
const KEYS = [...Object.keys(TEXT_FIELDS), ...VIDEO_FIELDS, "facebook_reel"];

export async function onRequestGet(context) {
  const user = await authorize(context);
  if (user.error) return user.error;
  try {
    const { results } = await context.env.DB.prepare("SELECT key,value FROM site_content").all();
    return respond({ content: Object.fromEntries((results || []).map(row => [row.key, row.value])) });
  } catch (error) {
    console.warn("Erreur lecture des contenus", error?.message);
    return respond({ error: "Contenus indisponibles : vérifiez la migration D1." }, 503);
  }
}
export async function onRequestPatch(context) {
  const user = await authorize(context, true);
  if (user.error) return user.error;
  try {
    const raw = await context.request.text();
    if (raw.length > 6000) return respond({ error: "Contenu trop long." }, 413);
    const body = JSON.parse(raw);
    const updates = {};
    for (const key of KEYS) {
      if (!(key in body)) continue;
      const value = cleanText(body[key], TEXT_FIELDS[key] || 200);
      if (VIDEO_FIELDS.includes(key) && !/^[a-zA-Z0-9_-]{11}$/.test(value))
        return respond({ error: "Identifiant YouTube incorrect : " + key }, 400);
      if (key === "facebook_reel" && value && !/^\d{8,25}$/.test(value))
        return respond({ error: "Identifiant de Reel Facebook incorrect." }, 400);
      updates[key] = value;
    }
    if (Object.keys(updates).length === 0) return respond({ error: "Aucun contenu à modifier." }, 400);
    const statements = Object.entries(updates).map(([key,value]) => context.env.DB.prepare(`INSERT INTO site_content
      (key,value,updated_by) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET
      value=excluded.value,updated_by=excluded.updated_by,updated_at=datetime('now')`).bind(key,value,user.email));
    await context.env.DB.batch(statements);
    return respond({ ok: true });
  } catch (error) {
    console.warn("Erreur publication de contenu", error?.message);
    return respond({ error: "Impossible d'enregistrer les modifications." }, 503);
  }
}
