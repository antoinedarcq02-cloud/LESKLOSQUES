// Cloudflare Pages / Workers : authentification par code e-mail à usage unique.
// Les données et les sessions sont protégées côté serveur, pas seulement par l'interface.
const COOKIE = "klosques_session";
const DAY = 86400;
const te = new TextEncoder();

export function respond(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin;
}
export function allowedEmails(env) {
  return String(env.ADMIN_EMAILS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}
export const normalizedEmail = value => String(value || "").trim().toLowerCase().slice(0, 254);
export const cleanText = (value, max = 2000) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T12:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export const statuses = ["nouveau", "en_discussion", "devis_envoye", "option", "confirme", "termine", "refuse"];
function hex(bytes) {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function mac(key, value) {
  const cryptoKey = await crypto.subtle.importKey("raw", te.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", cryptoKey, te.encode(value)));
}
function equals(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
export async function hashCode(env, email, code) {
  return mac(env.ADMIN_SESSION_SECRET, "otp:" + email + ":" + code);
}
function encode(value) {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function sessionCookie(env, email) {
  const body = encode({ e: email, exp: Math.floor(Date.now() / 1000) + 7 * DAY, v: 1 });
  const sig = await mac(env.ADMIN_SESSION_SECRET, "session:" + body);
  return COOKIE + "=" + body + "." + sig + "; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=" + (7 * DAY);
}
export const clearedSessionCookie = COOKIE + "=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
export async function authUser(request, env) {
  if (!env.ADMIN_SESSION_SECRET || !env.DB || allowedEmails(env).length === 0) return null;
  const raw = (request.headers.get("Cookie") || "").split(";").map(s => s.trim()).find(s => s.startsWith(COOKIE + "="));
  if (!raw) return null;
  const token = raw.slice(COOKIE.length + 1);
  const pos = token.lastIndexOf(".");
  if (pos < 1) return null;
  const body = token.slice(0, pos), signature = token.slice(pos + 1);
  if (!equals(signature, await mac(env.ADMIN_SESSION_SECRET, "session:" + body))) return null;
  try {
    const base64 = body.replace(/-/g, "+").replace(/_/g, "/");
    const data = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    if (data.v !== 1 || !Number.isFinite(data.exp) || data.exp <= Date.now() / 1000) return null;
    const email = normalizedEmail(data.e);
    return allowedEmails(env).includes(email) ? email : null;
  } catch { return null; }
}
export async function authorize(context, write = false) {
  if (!context.env.DB || !context.env.ADMIN_SESSION_SECRET || allowedEmails(context.env).length === 0)
    return { error: respond({ error: "Administration non configurée : base D1 et accès requis." }, 503) };
  if (write && !sameOrigin(context.request))
    return { error: respond({ error: "Origine non autorisée." }, 403) };
  const email = await authUser(context.request, context.env);
  return email ? { email } : { error: respond({ error: "Connexion nécessaire." }, 401) };
}
export async function limitByIp(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await mac(env.ADMIN_SESSION_SECRET, "ip:" + ip);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT INTO admin_login_limits (key_hash,counter,window_start)
    VALUES (?,1,?) ON CONFLICT(key_hash) DO UPDATE SET
    counter = CASE WHEN window_start < ? THEN 1 ELSE counter + 1 END,
    window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END`)
    .bind(key, now, now - 900, now - 900, now).run();
  const row = await env.DB.prepare("SELECT counter FROM admin_login_limits WHERE key_hash=?").bind(key).first();
  return Number(row?.counter || 0) <= 25;
}
