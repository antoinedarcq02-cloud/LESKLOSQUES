// Klosques Manager: comptes nominatifs, hachage PBKDF2 + secret serveur indépendant.
// Cloudflare Workers plafonne PBKDF2 WebCrypto à 100 000 itérations par opération.
// Authentification et autorisations intégralement côté serveur Cloudflare.
const COOKIE = "klosques_session";
const DAY = 86400;
const ITERATIONS = 100000;
const encoder = new TextEncoder();

export function respond(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin;
}
export const cleanText = (value, max = 2000) =>
  String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
export const normalizedUsername = value => String(value || "").trim().toLowerCase();
export const validUsername = value => /^[a-z][a-z0-9_-]{2,23}$/.test(value);
export function validPassword(password) {
  return typeof password === "string" && password.length >= 15 && password.length <= 128 &&
    password.trim().length >= 15;
}
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T12:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export const statuses = ["nouveau", "en_discussion", "devis_envoye", "option", "confirme", "termine", "refuse"];

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(value) {
  if (!/^(?:[0-9a-f]{2})+$/.test(value || "")) throw new Error("Format du hachage invalide.");
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
export function constantEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function mac(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}
export async function setupKeyMatches(env, submitted) {
  if (!env.ADMIN_SETUP_KEY || String(env.ADMIN_SETUP_KEY).length < 32 ||
      typeof submitted !== "string" || submitted.length > 300) return false;
  const [expected, actual] = await Promise.all([
    mac(env.ADMIN_SESSION_SECRET, "setup:" + env.ADMIN_SETUP_KEY),
    mac(env.ADMIN_SESSION_SECRET, "setup:" + submitted)
  ]);
  return constantEquals(expected, actual);
}
async function derive(password, saltHex, iterations) {
  if (!Number.isInteger(iterations) || iterations !== ITERATIONS)
    throw new Error("Paramètres de mot de passe invalides.");
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations, hash: "SHA-256" }, key, 256
  ));
}
// Le secret "ADMIN_PASSWORD_PEPPER" ne doit jamais être stocké dans D1 ni GitHub.
// L'attaquant qui obtient uniquement la base D1 ne peut pas tester des mots de passe hors ligne.
async function passwordInput(password, env) {
  if (!env?.ADMIN_PASSWORD_PEPPER || String(env.ADMIN_PASSWORD_PEPPER).length < 32)
    throw new Error("Le secret ADMIN_PASSWORD_PEPPER est absent ou trop court.");
  return mac(env.ADMIN_PASSWORD_PEPPER, "klosques-password-v1:" + password);
}
export async function hashPassword(password, env) {
  if (!validPassword(password))
    throw new Error("Choisis un mot de passe unique d'au moins 15 caractères (maximum 128).");
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const input = await passwordInput(password, env);
  return { password_salt: salt, password_hash: await derive(input, salt, ITERATIONS), password_iterations: ITERATIONS };
}
export async function verifyPassword(password, account, env) {
  if (typeof password !== "string" || password.length > 128 ||
      !account?.password_salt || !account?.password_hash) return false;
  const result = await derive(await passwordInput(password, env), account.password_salt, Number(account.password_iterations));
  return constantEquals(result, account.password_hash);
}
function encode(value) {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function sessionCookie(env, account) {
  const body = encode({
    v: 2, u: account.username, sv: account.session_version,
    exp: Math.floor(Date.now() / 1000) + 7 * DAY
  });
  const signature = await mac(env.ADMIN_SESSION_SECRET, "session:" + body);
  return COOKIE + "=" + body + "." + signature +
    "; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=" + (7 * DAY);
}
export const clearedSessionCookie =
  COOKIE + "=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0";

export async function authUser(request, env) {
  if (!env.ADMIN_SESSION_SECRET || !env.DB) return null;
  const raw = (request.headers.get("Cookie") || "").split(";")
    .map(s => s.trim()).find(s => s.startsWith(COOKIE + "="));
  if (!raw) return null;
  const token = raw.slice(COOKIE.length + 1);
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!constantEquals(signature, await mac(env.ADMIN_SESSION_SECRET, "session:" + body))) return null;
  try {
    const bytes = body.replace(/-/g, "+").replace(/_/g, "/");
    const data = JSON.parse(atob(bytes.padEnd(Math.ceil(bytes.length / 4) * 4, "=")));
    if (data.v !== 2 || !Number.isFinite(data.exp) || data.exp <= Date.now() / 1000 ||
        !validUsername(data.u) || !Number.isSafeInteger(data.sv)) return null;
    const account = await env.DB.prepare(
      "SELECT username,display_name,role,session_version,must_change_password,disabled FROM admin_users WHERE username=?"
    ).bind(data.u).first();
    if (!account || account.disabled || account.session_version !== data.sv) return null;
    return account;
  } catch { return null; }
}
export async function authorize(context, write = false) {
  if (!context.env.DB || !context.env.ADMIN_SESSION_SECRET)
    return { error: respond({ error: "Administration non configurée : base D1 et secret requis." }, 503) };
  if (write && !sameOrigin(context.request))
    return { error: respond({ error: "Origine non autorisée." }, 403) };
  const user = await authUser(context.request, context.env);
  if (!user) return { error: respond({ error: "Connexion nécessaire." }, 401) };
  if (user.must_change_password)
    return { error: respond({ error: "Change ton mot de passe provisoire avant de continuer.", code: "PASSWORD_CHANGE_REQUIRED" }, 403) };
  // Conserve le champ email pour les journaux de modification des dossiers existants ;
  // sa valeur est désormais l'identifiant du musicien (aucun email nécessaire).
  return { email: user.username, user };
}
export async function rateLimit(env, label, threshold = 25) {
  const key = await mac(env.ADMIN_SESSION_SECRET, "rate:" + label);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(\`INSERT INTO admin_login_limits(key_hash,counter,window_start)
    VALUES (?,1,?) ON CONFLICT(key_hash) DO UPDATE SET
    counter=CASE WHEN window_start < ? THEN 1 ELSE counter + 1 END,
    window_start=CASE WHEN window_start < ? THEN ? ELSE window_start END\`)
    .bind(key, now, now - 900, now - 900, now).run();
  const row = await env.DB.prepare("SELECT counter FROM admin_login_limits WHERE key_hash=?").bind(key).first();
  return Number(row?.counter || 0) <= threshold;
}
export async function loginRateLimit(request, env, username = "") {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const [byIp, byName] = await Promise.all([
    rateLimit(env, "ip:" + ip, 25),
    rateLimit(env, "username:" + username, 12)
  ]);
  return byIp && byName;
}
