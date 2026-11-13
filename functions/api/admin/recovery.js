// Reprise exceptionnelle des 4 comptes : aucune empreinte de mot de passe n'est
// calculée dans le navigateur. Le secret de Production reste côté Cloudflare.
// Chaque clé temporaire ne peut réussir qu'une seule fois.
import {
  respond, sameOrigin, setupKeyMatches, validPassword, normalizedUsername,
  validUsername, cleanText, hashPassword, rateLimit
} from "../../_lib/admin-auth.js";

const encoder = new TextEncoder();

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return respond({ error: "Origine non autorisée." }, 403);
  if (!env.DB || !env.ADMIN_SESSION_SECRET || !env.ADMIN_PASSWORD_PEPPER)
    return respond({ error: "Production : DB ou secrets manquants." }, 503);
  if (!env.ADMIN_SETUP_KEY || String(env.ADMIN_SETUP_KEY).length < 32)
    return respond({ error: "Ajoute d'abord ADMIN_SETUP_KEY dans les secrets Production, puis redéploie le site." }, 503);
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!(await rateLimit(env, "account-recovery:" + ip, 6)))
      return respond({ error: "Trop d'essais. Réessaie dans 15 minutes." }, 429);

    const raw = await request.text();
    if (raw.length > 5000) return respond({ error: "Requête trop longue." }, 413);
    const data = JSON.parse(raw);
    if (data.action !== "rebuild_four" ||
        typeof data.setup_key !== "string" || data.setup_key.length > 300 ||
        !(await setupKeyMatches(env, data.setup_key)))
      return respond({ error: "Clé temporaire incorrecte. Vérifie le secret Production ADMIN_SETUP_KEY." }, 403);

    if (!Array.isArray(data.users) || data.users.length !== 4)
      return respond({ error: "Renseigne exactement quatre musiciens." }, 400);

    const users = data.users.map((item, index) => ({
      username: normalizedUsername(item && item.username),
      display_name: cleanText(item && item.display_name, 60),
      password: item && item.password,
      role: index === 0 ? "admin" : "member"
    }));
    if (users.some(user => !validUsername(user.username) ||
        user.display_name.length < 2 || !validPassword(user.password)))
      return respond({ error: "Identifiants : 3 à 24 caractères sans accent. Prénoms obligatoires et mots de passe d'au moins 15 caractères." }, 400);
    if (new Set(users.map(user => user.username)).size !== 4)
      return respond({ error: "Les quatre identifiants doivent être différents." }, 400);
    if (new Set(users.map(user => user.password)).size !== 4)
      return respond({ error: "Choisis quatre mots de passe différents." }, 400);

    // Empreinte non réversible de la clé à usage unique ; la clé ne va jamais dans D1.
    const fingerprint = hex(await crypto.subtle.digest("SHA-256", encoder.encode(data.setup_key)));
    const marker = "account_recovery_used:" + fingerprint;
    const used = await env.DB.prepare("SELECT key FROM site_content WHERE key=?").bind(marker).first();
    if (used) return respond({ error: "Cette clé de reprise a déjà servi. Elle doit être supprimée dans Cloudflare." }, 409);

    const current = await env.DB.prepare(
      "SELECT username,role FROM admin_users ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END, username"
    ).all();
    const originals = current.results || [];
    if (originals.length !== 4 || originals.filter(user => user.role === "admin").length !== 1)
      return respond({ error: "La base ne contient pas exactement quatre comptes dont un administrateur. Aucune modification effectuée." }, 409);

    // Le serveur Cloudflare utilise SA propre valeur d'ADMIN_PASSWORD_PEPPER.
    const hashes = [];
    for (const user of users) hashes.push(await hashPassword(user.password, env));

    // D1.batch est transactionnel : si une requête échoue, aucun changement
    // (y compris sur les identifiants et le marqueur de reprise) n'est conservé.
    // Une phase de noms temporaires permet de permuter les identifiants sans conflit.
    const temporary = originals.map(() => "hold_" + crypto.randomUUID().replace(/-/g, "").slice(0, 17));
    const commands = [
      env.DB.prepare("INSERT INTO site_content(key,value,updated_by) VALUES(?,?,?)")
        .bind(marker, "used", "account_recovery")
    ];
    for (let i = 0; i < 4; i++) {
      commands.push(env.DB.prepare(
        "UPDATE admin_users SET username=? WHERE username=?"
      ).bind(temporary[i], originals[i].username));
    }
    for (let i = 0; i < 4; i++) {
      commands.push(env.DB.prepare(
        "UPDATE admin_users SET username=?,display_name=?,password_salt=?,password_hash=?,password_iterations=?," +
        "role=?,must_change_password=0,disabled=0,session_version=session_version+1," +
        "last_login_at=NULL,updated_at=datetime('now') WHERE username=?"
      ).bind(users[i].username, users[i].display_name, hashes[i].password_salt,
        hashes[i].password_hash, hashes[i].password_iterations, users[i].role, temporary[i]));
    }
    await env.DB.batch(commands);
    return respond({ ok: true, message: "Les quatre comptes ont été reconfigurés. Retire maintenant ADMIN_SETUP_KEY de Cloudflare." });
  } catch (error) {
    console.warn("Reprise des comptes Klosques Manager impossible", error?.message || error);
    return respond({ error: "Opération interrompue. Vérifie la configuration de Production ; aucune donnée ne doit être supprimée." }, 503);
  }
}
