import { authorize, respond } from "../../../_lib/admin-auth.js";
import { ensureQuoteEmailLog } from "../../../_lib/quote-mail.js";

// Suppression explicite d'un seul devis (brouillon ou finalisé).
// La confirmation est demandée dans Klosques Manager avant cet appel.
export async function onRequestDelete(context) {
  const user = await authorize(context, true);
  if (user.error) return user.error;
  const rawId = context.params.id;
  if (!/^[1-9]\d{0,14}$/.test(rawId || ""))
    return respond({ error: "Identifiant du devis invalide." }, 400);
  const id = Number(rawId);
  if (!Number.isSafeInteger(id))
    return respond({ error: "Identifiant du devis invalide." }, 400);
  try {
    // La suppression du devis efface aussi son historique d'envoi local.
    await ensureQuoteEmailLog(context.env.DB);
    // Requête paramétrée : aucun autre devis ni aucune demande client ne sont touchés.
    const result = await context.env.DB.prepare(
      "DELETE FROM official_quotes WHERE id=?"
    ).bind(id).run();
    if (!result.meta?.changes)
      return respond({ error: "Devis introuvable ou déjà supprimé." }, 404);
    try {
      await context.env.DB.prepare(
        "DELETE FROM quote_email_sends WHERE quote_id=?"
      ).bind(id).run();
    } catch (error) {
      console.warn("Suppression du devis réussie, nettoyage du journal e-mail impossible", error?.message);
    }
    return respond({ ok: true, deleted: true });
  } catch (error) {
    console.warn("Erreur suppression devis", error?.message);
    return respond({ error: "Impossible de supprimer ce devis pour le moment." }, 503);
  }
}
