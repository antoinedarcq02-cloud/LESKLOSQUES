import { authorize } from "../../../../_lib/admin-auth.js";
import { ensureInvoiceTables, publicInvoice, validInvoiceId } from "../../../../_lib/invoice-core.js";
import { createInvoicePdf } from "../../../../_lib/invoice-pdf.js";
export async function onRequestGet(context){
  const user=await authorize(context);
  if(user.error)return user.error;
  const id=context.params.id;
  if(!validInvoiceId(id))return new Response("Facture introuvable.",{status:400});
  try{
    await ensureInvoiceTables(context.env.DB);
    const row=await context.env.DB.prepare("SELECT * FROM official_invoices WHERE id=?").bind(id).first();
    if(!row)return new Response("Facture introuvable.",{status:404});
    const invoice=publicInvoice(row);
    const pdf=createInvoicePdf(invoice);
    const file=(invoice.number||"BROUILLON-"+id.slice(0,8))+".pdf";
    return new Response(pdf,{
      headers:{
        "Content-Type":"application/pdf",
        "Content-Disposition":'attachment; filename="'+file+'"',
        "Cache-Control":"no-store",
        "X-Content-Type-Options":"nosniff"
      }
    });
  }catch(error){
    console.warn("Erreur création PDF facture",error?.message);
    return new Response("Impossible de générer le PDF.",{status:503});
  }
}
