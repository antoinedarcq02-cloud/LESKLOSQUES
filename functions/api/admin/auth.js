import {
  respond, sameOrigin, normalizedUsername, validUsername, cleanText, validPassword,
  setupKeyMatches, hashPassword, verifyPassword, sessionCookie,
  clearedSessionCookie, authUser, loginRateLimit
} from "../../_lib/admin-auth.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB || !env.ADMIN_SESSION_SECRET)
    return respond({ error: "Administration non configurée : DB / ADMIN_SESSION_SECRET." }, 503);
  try {
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM admin_users").first();
    const account = await authUser(request, env);
    return respond({
      authenticated: !!account,
      needsSetup: Number(count?.total || 0) === 0,
      username: account?.username || null,
      display_name: account?.display_name || null,
      role: account?.role || null,
      must_change_password: !!account?.must_change_password
    });
  } catch (error) {
    console.warn("Auth: table admin_users absente ou inaccessible", error?.message);
    return respond({ error: "Il faut exécuter la migration D1 0002_personal_passwords.sql." }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return respond({ error: "Origine non autorisée." }, 403);
  if (!env.DB || !env.ADMIN_SESSION_SECRET)
    return respond({ error: "Administration non configurée : DB / ADMIN_SESSION_SECRET." }, 503);
  try {
    const raw = await request.text();
    if (raw.length > 4000) return respond({ error: "Requête trop longue." }, 413);
    const data = JSON.parse(raw);
    const action = String(data.action || "");
    if (action === "logout")
      return respond({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie });

    if (!["login", "bootstrap"].includes(action))
      return respond({ error: "Action inconnue." }, 400);

    const username = normalizedUsername(data.username);
    if (!validUsername(username))
      return respond({ error: "Identifiant ou mot de passe incorrect." }, 401);
    if (!(await loginRateLimit(request, env, username)))
      return respond({ error: "Trop de tentatives. Réessaie dans 15 minutes." }, 429);

    const password = data.password;
    if (action === "bootstrap") {
      // Un secret temporaire Cloudflare permet de créer UNIQUEMENT le premier compte.
      const current = await env.DB.prepare("SELECT COUNT(*) AS total FROM admin_users").first();
      if (Number(current?.total || 0) !== 0)
        return respond({ error: "Initialisation déjà effectuée." }, 409);
      if (!(await setupKeyMatches(env, data.setup_key)))
        return respond({ error: "Clé d'initialisation invalide ou non configurée." }, 403);
      if (!validPassword(password))
        return respond({ error: "Utilise un mot de passe unique d'au moins 15 caractères." }, 400);
      const displayName = cleanText(data.display_name, 60);
      if (displayName.length < 2)
        return respond({ error: "Indique le prénom du musicien." }, 400);
      const hashes = await hashPassword(password);
      const result = await env.DB.prepare(\`INSERT INTO admin_users
        (username,display_name,password_salt,password_hash,password_iterations,role)
        SELECT ?,?,?,?,?, 'admin' WHERE NOT EXISTS(SELECT 1 FROM admin_users)\`)
        .bind(username,displayName,hashes.password_salt,hashes.password_hash,hashes.password_iterations).run();
      if (!result.meta?.changes) return respond({ error: "Compte déjà initialisé." }, 409);
      const account = { username, display_name: displayName, role: "admin", session_version: 1, must_change_password: 0 };
      return respond({ ok: true, username, display_name: displayName, role: "admin",
        must_change_password: false }, 201, { "Set-Cookie": await sessionCookie(env, account) });
    }

    if (typeof password !== "string" || password.length > 128)
      return respond({ error: "Identifiant ou mot de passe incorrect." }, 401);
    const account = await env.DB.prepare("SELECT * FROM admin_users WHERE username=?").bind(username).first();
    if (!account || account.disabled || !(await verifyPassword(password, account)))
      return respond({ error: "Identifiant ou mot de passe incorrect." }, 401);
    await env.DB.prepare("UPDATE admin_users SET last_login_at=datetime('now') WHERE username=?").bind(username).run();
    return respond({
      ok: true, username, display_name: account.display_name,
      role: account.role, must_change_password: !!account.must_change_password
    }, 200, { "Set-Cookie": await sessionCookie(env, account) });
  } catch (error) {
    console.warn("Erreur de connexion Klosques Manager", error?.message);
    return respond({ error: "Connexion impossible. Vérifie la migration D1 et réessaie." }, 503);
  }
}
