import {
  authorize, respond, cleanText, normalizedUsername, validUsername,
  validPassword, hashPassword, verifyPassword
} from "../../_lib/admin-auth.js";

async function adminOnly(context) {
  const access = await authorize(context, context.request.method !== "GET");
  if (access.error) return access;
  if (access.user.role !== "admin")
    return { error: respond({ error: "Accès réservé au gestionnaire des comptes." }, 403) };
  return access;
}
export async function onRequestGet(context) {
  const access = await adminOnly(context);
  if (access.error) return access.error;
  try {
    const { results } = await context.env.DB.prepare(
      "SELECT username,display_name,role,must_change_password,disabled,created_at,last_login_at FROM admin_users ORDER BY role ASC, username ASC"
    ).all();
    return respond({ users: results || [] });
  } catch { return respond({ error: "Impossible de lire les comptes." }, 503); }
}
export async function onRequestPost(context) {
  const access = await adminOnly(context);
  if (access.error) return access.error;
  try {
    const raw = await context.request.text();
    if (raw.length > 4000) return respond({ error: "Requête trop longue." }, 413);
    const data = JSON.parse(raw);
    if (data.action !== "create" && data.action !== "reset")
      return respond({ error: "Action invalide." }, 400);
    const username = normalizedUsername(data.username);
    if (!validUsername(username)) return respond({ error: "Identifiant invalide (3 à 24 caractères, sans accents)." }, 400);
    if (!validPassword(data.password))
      return respond({ error: "Mot de passe provisoire requis : au moins 15 caractères." }, 400);
    // Une opération sensible nécessite de confirmer le mot de passe du gestionnaire.
    const admin = await context.env.DB.prepare("SELECT * FROM admin_users WHERE username=?")
      .bind(access.user.username).first();
    if (!admin || !(await verifyPassword(data.admin_password, admin, context.env)))
      return respond({ error: "Mot de passe du gestionnaire incorrect." }, 401);
    const hash = await hashPassword(data.password, context.env);
    if (data.action === "create") {
      const display = cleanText(data.display_name, 60);
      if (display.length < 2) return respond({ error: "Prénom obligatoire." }, 400);
      const existing = await context.env.DB.prepare("SELECT username FROM admin_users WHERE username=?").bind(username).first();
      if (existing) return respond({ error: "Identifiant déjà utilisé." }, 409);
      const count = await context.env.DB.prepare("SELECT COUNT(*) AS total FROM admin_users").first();
      if (Number(count.total) >= 4) return respond({ error: "Quatre musiciens maximum." }, 409);
      await context.env.DB.prepare(`INSERT INTO admin_users
        (username,display_name,password_salt,password_hash,password_iterations,role,must_change_password)
        VALUES (?,?,?,?,?,'member',1)`)
        .bind(username,display,hash.password_salt,hash.password_hash,hash.password_iterations).run();
      return respond({ ok: true }, 201);
    }
    if (username === access.user.username)
      return respond({ error: "Utilise « Modifier mon mot de passe » pour ton propre compte." }, 400);
    const existing = await context.env.DB.prepare("SELECT role FROM admin_users WHERE username=?").bind(username).first();
    if (!existing || existing.role !== "member")
      return respond({ error: "Ce musicien ne peut pas être réinitialisé ici." }, 404);
    await context.env.DB.prepare(`UPDATE admin_users SET
      password_salt=?,password_hash=?,password_iterations=?,must_change_password=1,
      session_version=session_version+1,updated_at=datetime('now') WHERE username=?`)
      .bind(hash.password_salt,hash.password_hash,hash.password_iterations,username).run();
    return respond({ ok: true });
  } catch (error) {
    console.warn("Erreur gestion comptes", error?.message);
    return respond({ error: "Impossible d'enregistrer le compte. Vérifie qu'il reste une place." }, 503);
  }
}
