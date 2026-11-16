// Connexions partagées pour le groupe. Les jetons restent côté serveur, chiffrés
// dans D1 avec une clé AES issue du secret de session existant (jamais en JS public).
const encoder=new TextEncoder();
const decoder=new TextDecoder();
const hex64=/^[A-Za-z0-9_-]{20,100}$/;
const PROVIDERS=new Set(["google","microsoft"]);
const MAIL_SCOPE="offline_access Mail.Read Mail.Send User.Read";
export const EXPECTED_OUTLOOK="LesKlosques@hotmail.com";

export function integrationConfig(env,provider){
  if(provider==="google")return{
    id:String(env.GOOGLE_CLIENT_ID||""),secret:String(env.GOOGLE_CLIENT_SECRET||""),
    auth:"https://accounts.google.com/o/oauth2/v2/auth",
    token:"https://oauth2.googleapis.com/token",
    scopes:"https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.calendarlist.readonly"
  };
  if(provider==="microsoft")return{
    id:String(env.MICROSOFT_CLIENT_ID||""),secret:String(env.MICROSOFT_CLIENT_SECRET||""),
    auth:"https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
    token:"https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    scopes:MAIL_SCOPE
  };
  throw Error("Fournisseur inconnu.");
}
export function randomBase64(bytes=32){
  const array=crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...array)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
export async function pkceChallenge(verifier){
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function fromBase64(value){
  if(!/^[A-Za-z0-9_-]+$/.test(value))throw Error("Jeton chiffré invalide.");
  const raw=atob(value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"="));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function toBase64(data){
  return btoa(String.fromCharCode(...new Uint8Array(data))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function secretKey(env){
  if(!env.ADMIN_SESSION_SECRET||String(env.ADMIN_SESSION_SECRET).length<32)
    throw Error("Secret de session absent.");
  const hkdf=await crypto.subtle.importKey("raw",encoder.encode(env.ADMIN_SESSION_SECRET),
    "HKDF",false,["deriveKey"]);
  return crypto.subtle.deriveKey({
    name:"HKDF",hash:"SHA-256",salt:encoder.encode("klosques-manager/oauth-v1"),
    info:encoder.encode("stored-provider-refresh-tokens")
  },hkdf,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
export async function sealToken(env,value){
  if(typeof value!=="string"||!value||value.length>8000)throw Error("Jeton impossible à enregistrer.");
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv},await secretKey(env),encoder.encode(value));
  return toBase64(iv)+"."+toBase64(ciphertext);
}
export async function unsealToken(env,value){
  if(typeof value!=="string"||value.split(".").length!==2)throw Error("Jeton impossible à lire.");
  const [iv,bytes]=value.split(".");
  const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromBase64(iv)},
    await secretKey(env),fromBase64(bytes));
  return decoder.decode(plaintext);
}
export async function ensureIntegrationTables(DB){
  await DB.batch([
    DB.prepare("CREATE TABLE IF NOT EXISTS connected_services (provider TEXT PRIMARY KEY CHECK(provider IN ('google','microsoft')), encrypted_refresh TEXT NOT NULL, account_label TEXT NOT NULL DEFAULT '', connected_by TEXT NOT NULL, connected_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS oauth_connect_states (nonce TEXT PRIMARY KEY, provider TEXT NOT NULL, code_verifier TEXT NOT NULL, started_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS google_concert_links (booking_id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, synced_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS google_event_optouts (booking_id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    // File de suppression durable : un incident Google ne doit plus bloquer D1.
    DB.prepare("CREATE TABLE IF NOT EXISTS google_pending_removals (booking_id TEXT PRIMARY KEY,calendar_id TEXT NOT NULL DEFAULT '',event_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    // Les anciens accès Microsoft en lecture seule restent valables pour lire,
    // mais n'activent jamais les envois sans un NOUVEAU consentement Mail.Send.
    DB.prepare("CREATE TABLE IF NOT EXISTS microsoft_mail_authorizations (provider TEXT PRIMARY KEY CHECK(provider='microsoft'), account_label TEXT NOT NULL,authorized_at TEXT NOT NULL DEFAULT (datetime('now')))")
  ]);
}
export async function getConnected(DB,provider){
  if(!PROVIDERS.has(provider))throw Error("Fournisseur inconnu.");
  return DB.prepare("SELECT provider,encrypted_refresh,account_label,connected_at FROM connected_services WHERE provider=?").bind(provider).first();
}
export async function saveConnected(env,provider,refresh,label,user){
  if(!PROVIDERS.has(provider))throw Error("Fournisseur inconnu.");
  await ensureIntegrationTables(env.DB);
  const encrypted=await sealToken(env,refresh);
  return env.DB.prepare("INSERT INTO connected_services(provider,encrypted_refresh,account_label,connected_by) VALUES(?,?,?,?) ON CONFLICT(provider) DO UPDATE SET encrypted_refresh=excluded.encrypted_refresh,account_label=excluded.account_label,connected_by=excluded.connected_by,connected_at=datetime('now')")
    .bind(provider,encrypted,String(label||"").slice(0,180),String(user).slice(0,80)).run();
}
export async function providerAccessToken(env,provider){
  const config=integrationConfig(env,provider);
  if(!config.id||!config.secret)throw Error("Identifiants OAuth non configurés.");
  await ensureIntegrationTables(env.DB);
  const stored=await getConnected(env.DB,provider);
  const refresh=stored?await unsealToken(env,stored.encrypted_refresh):
    provider==="google"?String(env.GOOGLE_REFRESH_TOKEN||""):"";
  if(!refresh)throw Error("Compte non connecté.");
  const params=new URLSearchParams({
    client_id:config.id,client_secret:config.secret,refresh_token:refresh,
    grant_type:"refresh_token"
  });
  if(provider==="microsoft")params.set("scope",config.scopes);
  const res=await fetch(config.token,{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:params.toString()
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok||typeof data.access_token!=="string")
    throw Error("Accès expiré ou révoqué : reconnecte le compte "+provider+".");
  if(stored && data.refresh_token && data.refresh_token!==refresh)
    await saveConnected(env,provider,data.refresh_token,stored.account_label,"renouvellement");
  return data.access_token;
}
export function callbackUrl(origin,provider){
  if(!PROVIDERS.has(provider))throw Error("Fournisseur inconnu.");
  return origin+"/api/admin/connect/"+provider+"/callback";
}
export function oauthStartUrl(env,provider,origin,nonce,verifierChallenge){
  const config=integrationConfig(env,provider);
  if(!config.id||!config.secret)throw Error("Identifiants OAuth non configurés.");
  const q=new URLSearchParams({
    client_id:config.id,response_type:"code",redirect_uri:callbackUrl(origin,provider),
    scope:config.scopes,state:nonce,code_challenge:verifierChallenge,code_challenge_method:"S256"
  });
  if(provider==="google"){q.set("access_type","offline");q.set("prompt","consent");}
  else q.set("response_mode","query");
  return config.auth+"?"+q.toString();
}
export function validOauthState(value){return typeof value==="string"&&hex64.test(value);}
