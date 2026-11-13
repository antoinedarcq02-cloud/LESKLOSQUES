import {
  respond, sameOrigin, authUser, verifyPassword, validPassword,
  hashPassword, sessionCookie
} from "../../_lib/admin-auth.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return respond({ error: "Origine non autorisée." }, 403);
  if (!env.DB || !env.ADMIN_SESSION_SECRET)
    return respond({ error: "Administration non configurée." }, 503);
  try {
    const user = await authUser(request, env);
    if (!user) return respond({ error: "Connexion nécessaire." }, 401);
    const raw = await request.text();
    if (raw.length > 4000) return respond({ error: "Requête trop longue." }, 413);
    const data = JSON.parse(raw);
    const current = await env.DB.prepare("SELECT * FROM admin_users WHERE username=?").bind(user.username).first();
    if (!current || !(await verifyPassword(data.current_password, current, env)))
      return respond({ error: "Mot de passe actuel incorrect." }, 401);
    const newPassword = data.new_password;
    if (!validPassword(newPassword))
      return respond({ error: "Le nouveau mot de passe doit contenir au moins 15 caractères." }, 400);
    if (newPassword === data.current_password)
      return respond({ error: "Choisis un nouveau mot de passe différent de l'ancien." }, 400);
    const hashes = await hashPassword(newPassword, env);
    const result = await env.DB.prepare(`UPDATE admin_users SET
      password_salt=?,password_hash=?,password_iterations=?,
      must_change_password=0,session_version=session_version+1,updated_at=datetime('now')
      WHERE username=? AND password_hash=?`)
      .bind(hashes.password_salt,hashes.password_hash,hashes.password_iterations,
        current.username,current.password_hash).run();
    if (!result.meta?.changes) return respond({ error: "Le compte a été modifié entre-temps. Réessaie." }, 409);
    const updated = await env.DB.prepare(
      "SELECT username,display_name,role,session_version,must_change_password FROM admin_users WHERE username=?"
    ).bind(current.username).first();
    return respond({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env, updated) });
  } catch (error) {
    console.warn("Erreur changement mot de passe", error?.message);
    return respond({ error: "Modification impossible." }, 503);
  }
}
