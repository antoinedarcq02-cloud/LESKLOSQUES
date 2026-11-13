import { authorize, respond } from "../../../../_lib/admin-auth.js";
import { ensureInvoiceTables, validInvoiceId } from "../../../../_lib/invoice-core.js";
import { ensureInvoiceTestAudit, INITIAL_TEST_CONDITIONS } from "../../../../_lib/invoice-test-reset.js";

// Uniquement pour réinitialiser le premier document fictif non utilisé du
// Manager. Interdit pour les factures réelles ou après toute autre émission.
export async function onRequestPost(context) {
  const user=await authorize(context,true);
  if(user.error)return user.error;
  if(user.user?.role!=="admin")
    return respond({error:"Seul le responsable du Manager peut effectuer ce nettoyage exceptionnel."},403);
  const id=context.params.id;
  if(!validInvoiceId(id))
    return respond({error:"Identifiant de facture invalide."},400);
  let payload;
  try {
    const raw=await context.request.text();
    if(raw.length>600)return respond({error:"Confirmation trop longue."},413);
    payload=JSON.parse(raw);
  }catch {
    return respond({error:"Confirmation invalide."},400);
  }
  if(payload?.confirmation!=="SUPPRIMER TEST" || payload?.never_used!==true)
    return respond({error:"Confirme explicitement que cette facture était uniquement un test, jamais transmis, payé ou comptabilisé."},400);
  try{
    const DB=context.env.DB;
    await ensureInvoiceTables(DB);
    await ensureInvoiceTestAudit(DB);
    // Sauvegarde d'audit avant toute suppression : identité du document,
    // numéro émis et contenu d'origine sont conservés côté serveur.
    // Seul le document numéro 1, unique, sans paiement ni envoi est éligible.
    const step=await DB.batch([
      DB.prepare(`INSERT INTO invoice_test_resets
        (invoice_id, original_number, original_data_json, original_issued_at, reset_by, reason)
        SELECT i.id,i.number,i.data_json,i.issued_at,?,
          'Document fictif de test, jamais transmis, comptabilisé ou payé'
        FROM official_invoices i
        WHERE i.id=? AND ${INITIAL_TEST_CONDITIONS}`)
        .bind(user.email,id),
      DB.prepare(`DELETE FROM invoice_archives
        WHERE invoice_id=? AND EXISTS (
          SELECT 1 FROM invoice_test_resets WHERE invoice_id=?
        )`).bind(id,id),
      DB.prepare(`DELETE FROM official_invoices
        WHERE id=? AND status='emise' AND number=1
          AND EXISTS (SELECT 1 FROM invoice_test_resets WHERE invoice_id=?)`).bind(id,id),
      DB.prepare(`DELETE FROM invoice_sequence
        WHERE invoice_id=? AND number=1
          AND EXISTS (SELECT 1 FROM invoice_test_resets WHERE invoice_id=?)`).bind(id,id),
      // SQLite conserve autrement le dernier compteur AUTOINCREMENT.
      // Aucun numéro réel n'a encore été attribué ; le premier vrai
      // document pourra donc commencer à FAC-000001.
      DB.prepare(`DELETE FROM sqlite_sequence
        WHERE name='invoice_sequence'
          AND NOT EXISTS (SELECT 1 FROM invoice_sequence)
          AND EXISTS (SELECT 1 FROM invoice_test_resets WHERE invoice_id=?)`).bind(id)
    ]);
    if(!step[0]?.meta?.changes)
      return respond({error:"Nettoyage refusé : cette facture n'est pas l'unique premier test non envoyé et non payé, ou un nettoyage a déjà eu lieu."},409);
    return respond({ok:true,removed:true,reset_numbering:true,
      message:"La facture de test a été retirée du Manager ; une trace d'audit interne a été conservée."});
  }catch(error){
    console.warn("Nettoyage exceptionnel de facture refusé",error?.message);
    return respond({error:"Impossible de nettoyer cette facture de test. Aucun nouveau nettoyage ne doit être tenté sans vérification."},503);
  }
}
