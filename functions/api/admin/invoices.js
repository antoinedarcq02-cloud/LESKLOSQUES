import { authorize, respond } from "../../_lib/admin-auth.js";
import { ensureInvoiceTables, parseInvoice, validateIssuance, validInvoiceId, invoiceLocalDate, publicInvoice } from "../../_lib/invoice-core.js";
import { quoteMailReady } from "../../_lib/quote-mail.js";

const DRAFT_PROFILE="quote_issuer_profile";
const validBooking=id=>id==null||id===""||validInvoiceId(id);
function invoiceError(error){
  const reason=String(error?.message||"");
  return /^(Informations|Champ incorrect|Choisis|Adresse e-mail|Date invalide|Heure invalide|12 prestations|Vérifie|Montant|Renseigne|La date)/.test(reason);
}
export async function onRequestGet(context){
  const user=await authorize(context);
  if(user.error)return user.error;
  try{
    const DB=context.env.DB;
    await ensureInvoiceTables(DB);
    const [rows,history,profile]=await Promise.all([
      DB.prepare("SELECT * FROM official_invoices ORDER BY created_at DESC,id DESC LIMIT 200").all(),
      DB.prepare("SELECT invoice_id,recipient,sent_at FROM invoice_email_sends ORDER BY id DESC LIMIT 500").all(),
      DB.prepare("SELECT value FROM site_content WHERE key=?").bind(DRAFT_PROFILE).first()
    ]);
    let issuer={};
    try{if(profile?.value)issuer=JSON.parse(profile.value);}catch{issuer={};}
    const last=new Map();
    for(const event of history.results||[])
      if(!last.has(event.invoice_id))last.set(event.invoice_id,event);
    const invoices=(rows.results||[]).map(r=>{
      const invoice=publicInvoice(r),sent=last.get(r.id);
      return {...invoice,sent_at:sent?.sent_at||null,sent_to:sent?.recipient||null};
    });
    return respond({invoices,issuer,mail_ready:quoteMailReady(context.env)});
  }catch(error){
    console.warn("Erreur liste factures",error?.message);
    return respond({error:"Factures temporairement indisponibles."},503);
  }
}
export async function onRequestPost(context){
  const user=await authorize(context,true);
  if(user.error)return user.error;
  let body;
  try{
    const content=await context.request.text();
    if(content.length>32000)return respond({error:"Facture trop volumineuse."},413);
    body=JSON.parse(content);
  }catch{return respond({error:"Données illisibles."},400);}
  if(!body||!["save","issue","mark_paid","mark_unpaid"].includes(body.action))
    return respond({error:"Action inconnue."},400);
  const DB=context.env.DB;
  try{
    await ensureInvoiceTables(DB);
    if(body.action==="mark_paid"||body.action==="mark_unpaid"){
      if(!validInvoiceId(body.id))return respond({error:"Identifiant de facture invalide."},400);
      const flag=body.action==="mark_paid"?1:0;
      const r=await DB.prepare("UPDATE official_invoices SET paid=?,paid_at=CASE WHEN ?=1 THEN datetime('now') ELSE NULL END,updated_at=datetime('now'),updated_by=? WHERE id=? AND status='emise'")
        .bind(flag,flag,user.email,body.id).run();
      if(!r.meta?.changes)return respond({error:"Facture émise introuvable."},404);
      const saved=await DB.prepare("SELECT * FROM official_invoices WHERE id=?").bind(body.id).first();
      return respond({invoice:publicInvoice(saved)});
    }
    const data=parseInvoice(body.data);
    const bookingId=body.booking_id||null;
    const quoteId=body.quote_id||null;
    if(!validBooking(bookingId)||quoteId!=null&&(!Number.isSafeInteger(quoteId)||quoteId<1))
      return respond({error:"Dossier client ou devis source invalide."},400);
    if(body.action==="issue")validateIssuance(data);
    if(body.id!=null&&!validInvoiceId(body.id))
      return respond({error:"Identifiant de facture invalide."},400);
    let id=body.id;
    const issue=body.action==="issue";
    if(issue)data.issue_date=invoiceLocalDate();
    if(id){
      const existing=await DB.prepare("SELECT status FROM official_invoices WHERE id=?").bind(id).first();
      if(!existing)return respond({error:"Brouillon de facture introuvable."},404);
      if(existing.status!=="brouillon")
        return respond({error:"Une facture émise ne peut plus être modifiée."},409);
      if(issue){
        // Un numéro ne naît qu'à l'émission. D1.batch est transactionnel :
        // aucun saut de numéro si la modification de la facture échoue.
        await DB.batch([
          DB.prepare("INSERT INTO invoice_sequence (invoice_id) SELECT id FROM official_invoices WHERE id=? AND status='brouillon'").bind(id),
          DB.prepare("UPDATE official_invoices SET data_json=?,booking_id=?,quote_id=?,number=(SELECT number FROM invoice_sequence WHERE invoice_id=?),status='emise',issued_at=datetime('now'),updated_at=datetime('now'),updated_by=? WHERE id=? AND status='brouillon'")
            .bind(JSON.stringify(data),bookingId,quoteId,id,user.email,id)
        ]);
      }else{
        await DB.prepare("UPDATE official_invoices SET data_json=?,booking_id=?,quote_id=?,updated_at=datetime('now'),updated_by=? WHERE id=? AND status='brouillon'")
          .bind(JSON.stringify(data),bookingId,quoteId,user.email,id).run();
      }
    }else{
      id=crypto.randomUUID();
      if(issue){
        // Crée la facture brouillon puis réserve le numéro dans un seul lot.
        await DB.batch([
          DB.prepare("INSERT INTO official_invoices (id,booking_id,quote_id,data_json,updated_by) VALUES (?,?,?,?,?)")
            .bind(id,bookingId,quoteId,JSON.stringify(data),user.email),
          DB.prepare("INSERT INTO invoice_sequence (invoice_id) VALUES (?)").bind(id),
          DB.prepare("UPDATE official_invoices SET number=(SELECT number FROM invoice_sequence WHERE invoice_id=?),status='emise',issued_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND status='brouillon'")
            .bind(id,id)
        ]);
      }else{
        await DB.prepare("INSERT INTO official_invoices (id,booking_id,quote_id,data_json,updated_by) VALUES (?,?,?,?,?)")
          .bind(id,bookingId,quoteId,JSON.stringify(data),user.email).run();
      }
    }
    const saved=await DB.prepare("SELECT * FROM official_invoices WHERE id=?").bind(id).first();
    if(!saved||issue&&(!saved.number||saved.status!=="emise"))
      return respond({error:"Facture déjà émise ou impossible à modifier. Recharge la liste."},409);
    // Pour un brouillon, la requête UPDATE peut avoir modifié zéro ligne.
    if(!issue&&saved.status!=="brouillon")
      return respond({error:"Une facture émise ne peut pas être modifiée."},409);
    return respond({invoice:publicInvoice(saved)},body.id?200:201);
  }catch(error){
    if(invoiceError(error))return respond({error:error.message},400);
    if(String(error?.message||"").includes("UNIQUE")||String(error?.message||"").includes("constraint"))
      return respond({error:"Cette facture est déjà en cours de finalisation. Actualise la page."},409);
    console.warn("Erreur écriture facture",error?.message);
    return respond({error:"Impossible d'enregistrer la facture."},503);
  }
}
