import { authorize, respond } from "../../../_lib/admin-auth.js";
import { ensureInvoiceTables, validInvoiceId } from "../../../_lib/invoice-core.js";

// Les factures émises NE PEUVENT JAMAIS être supprimées par cette API.
// Leur rectification demande un document d'avoir ou une facture rectificative.
export async function onRequestDelete(context){
  const user=await authorize(context,true);
  if(user.error)return user.error;
  const id=context.params.id;
  if(!validInvoiceId(id))return respond({error:"Identifiant de facture invalide."},400);
  try{
    await ensureInvoiceTables(context.env.DB);
    const result=await context.env.DB.prepare(
      "DELETE FROM official_invoices WHERE id=? AND status='brouillon'"
    ).bind(id).run();
    if(!result.meta?.changes)
      return respond({error:"Seuls les brouillons peuvent être supprimés. Une facture émise doit être conservée."},409);
    return respond({ok:true,deleted:true});
  }catch(error){
    console.warn("Erreur suppression brouillon de facture",error?.message);
    return respond({error:"Suppression du brouillon impossible."},503);
  }
}
