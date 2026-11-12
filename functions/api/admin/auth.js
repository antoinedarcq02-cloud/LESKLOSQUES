import { allowedEmails, normalizedEmail, hashCode, sessionCookie, clearedSessionCookie, authUser, respond, sameOrigin, limitByIp } from "../../_lib/admin-auth.js";

export async function onRequestGet({ request, env }) {
  const email = await authUser(request, env);
  return respond({ authenticated: !!email, email: email || null });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return respond({ error: "Origine non autorisée." }, 403);
  if (!env.DB || !env.ADMIN_SESSION_SECRET || !env.ADMIN_EMAILS)
    return respond({ error: "Espace privé non configuré par l'administrateur." }, 503);
  try {
    const raw = await request.text();
    if (raw.length > 2000) return respond({ error: "Requête trop longue." }, 413);
    const data = JSON.parse(raw);
    const action = String(data.action || "");
    if (action === "logout") {
      return respond({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie });
    }
    if (!["request-code", "verify-code"].includes(action))
      return respond({ error: "Action inconnue." }, 400);
    if (!(await limitByIp(request, env))) return respond({ error: "Trop de tentatives. Réessayez plus tard." }, 429);
    const email = normalizedEmail(data.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !allowedEmails(env).includes(email)) {
      // Ne pas divulguer publiquement la liste des quatre comptes.
      if (action === "request-code") return respond({ ok: true });
      return respond({ error: "Code invalide ou expiré." }, 401);
    }
    const now = Math.floor(Date.now() / 1000);
    if (action === "request-code") {
      if (!env.RESEND_API_KEY || !env.EMAIL_FROM)
        return respond({ error: "Envoi des codes non configuré." }, 503);
      const previous = await env.DB.prepare("SELECT sent_at FROM admin_auth_challenges WHERE email=?").bind(email).first();
      if (previous && previous.sent_at > now - 60) return respond({ ok: true });
      const random = new Uint32Array(1);
      crypto.getRandomValues(random);
      const code = String(100000 + (random[0] % 900000));
      const hash = await hashCode(env, email, code);
      await env.DB.prepare(`INSERT INTO admin_auth_challenges (email,code_hash,expires_at,attempts,sent_at)
        VALUES (?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET
        code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,sent_at=excluded.sent_at`)
        .bind(email, hash, now + 600, now).run();
      const sent = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.EMAIL_FROM, to: [email],
          subject: "Code de connexion — Klosques Manager",
          text: "Votre code de connexion : " + code + "\n\nValable 10 minutes. Ne le communiquez à personne."
        })
      });
      if (!sent.ok) {
        await env.DB.prepare("DELETE FROM admin_auth_challenges WHERE email=?").bind(email).run();
        return respond({ error: "Impossible d'envoyer le code actuellement." }, 502);
      }
      return respond({ ok: true });
    }
    const code = String(data.code || "").trim();
    if (!/^\d{6}$/.test(code)) return respond({ error: "Le code doit contenir six chiffres." }, 400);
    const record = await env.DB.prepare("SELECT code_hash,expires_at,attempts FROM admin_auth_challenges WHERE email=?").bind(email).first();
    if (!record || record.expires_at < now || record.attempts >= 5)
      return respond({ error: "Code invalide ou expiré." }, 401);
    await env.DB.prepare("UPDATE admin_auth_challenges SET attempts=attempts+1 WHERE email=?").bind(email).run();
    const currentHash = await hashCode(env, email, code);
    if (currentHash !== record.code_hash) return respond({ error: "Code invalide ou expiré." }, 401);
    await env.DB.prepare("DELETE FROM admin_auth_challenges WHERE email=?").bind(email).run();
    return respond({ ok: true, email }, 200, { "Set-Cookie": await sessionCookie(env, email) });
  } catch (error) {
    console.warn("Erreur authentification Klosques Manager", error?.message);
    return respond({ error: "Service temporairement indisponible." }, 503);
  }
}
