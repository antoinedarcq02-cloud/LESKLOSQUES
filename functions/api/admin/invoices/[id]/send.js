import { authorize, respond } from "../../../../_lib/admin-auth.js";
import { ensureInvoiceTables, publicInvoice, validInvoiceId } from "../../../../_lib/invoice-core.js";
import { createInvoicePdf, encodePdfBase64 } from "../../../../_lib/invoice-pdf.js";
import { quoteMailReady } from "../../../../_lib/quote-mail.js";

const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPLY_TO="LesKlosques@hotmail.com";
function safe(s){
  return String(s??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
async function deliver(env,mail){
  if(!(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) && env.EMAIL && env.QUOTE_FROM_EMAIL){
    const result=await env.EMAIL.send({
      from:{name:"Les Klosques",email:env.QUOTE_FROM_EMAIL},
      to:mail.to,replyTo:REPLY_TO,subject:mail.subject,
      html:mail.html,text:mail.text,
      attachments:[{content:mail.attachment,filename:mail.filename,type:"application/pdf",disposition:"attachment"}]
    });
    if(!result?.messageId)throw Error("Aucune confirmation du service Cloudflare.");
    return{provider:"cloudflare",id:result.messageId};
  }
  const response=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{
      Authorization:"Bearer "+env.RESEND_API_KEY,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      from:"Les Klosques <"+env.RESEND_FROM_EMAIL+">",
      to:[mail.to],reply_to:REPLY_TO,subject:mail.subject,
      html:mail.html,text:mail.text,
      attachments:[{content:mail.attachment,filename:mail.filename}]
    })
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body.id){
    console.warn("Service email a refusé la facture",response.status);
    throw Error("Le service de messagerie n'a pas accepté l'envoi.");
  }
  return{provider:"resend",id:body.id};
}
export async function onRequestPost(context){
  const user=await authorize(context,true);
  if(user.error)return user.error;
  if(!validInvoiceId(context.params.id))
    return respond({error:"Identifiant de facture invalide."},400);
  let body;
  try{
    const raw=await context.request.text();
    if(raw.length>1000)return respond({error:"Confirmation trop longue."},413);
    body=JSON.parse(raw);
  }catch{return respond({error:"Confirmation invalide."},400);}
  if(body?.confirm_send!==true)return respond({error:"Confirmation explicite requise avant l'envoi."},400);
  if(!quoteMailReady(context.env))
    return respond({error:"Envoi non configuré : il faut une adresse d'expédition vérifiée et un service d'e-mail."},503);
  const DB=context.env.DB;
  try{
    await ensureInvoiceTables(DB);
    const row=await DB.prepare("SELECT * FROM official_invoices WHERE id=?").bind(context.params.id).first();
    if(!row)return respond({error:"Facture introuvable."},404);
    if(row.status!=="emise")return respond({error:"Émets la facture avant l'envoi."},409);
    const invoice=publicInvoice(row);
    let destination=invoice.data.client_email;
    if(row.booking_id){
      const booking=await DB.prepare("SELECT name,email FROM bookings WHERE id=?").bind(row.booking_id).first();
      if(!booking)return respond({error:"La demande client associée a été supprimée."},409);
      destination=booking.email;
    }
    const recipient=String(destination||"").trim();
    if(!EMAIL.test(recipient)||recipient.length>254)
      return respond({error:"Adresse e-mail client absente ou invalide."},409);
    const previous=await DB.prepare(
      "SELECT sent_at FROM invoice_email_sends WHERE invoice_id=? AND recipient=? ORDER BY id DESC LIMIT 1"
    ).bind(row.id,recipient).first();
    if(previous?.sent_at){
      const stamp=Date.parse(previous.sent_at.replace(" ","T")+"Z");
      if(Number.isFinite(stamp)&&Date.now()-stamp<120000)
        return respond({error:"Cette facture vient d'être envoyée. Attends deux minutes avant de la renvoyer."},429);
    }
    const pdf=createInvoicePdf(invoice);
    if(pdf.length>4*1024*1024)return respond({error:"Le PDF dépasse la taille autorisée."},413);
    const filename=invoice.number+".pdf";
    const subject="Votre facture Les Klosques - "+invoice.number;
    const text=[
      "Bonjour,","","Vous trouverez en pièce jointe votre facture "+invoice.number+
        " pour notre prestation musicale.",
      "Date de la prestation : "+(invoice.data.event_date||"à préciser"),
      "Échéance de paiement : "+(invoice.data.payment_due_date||"à préciser"),
      "",
      "Pour toute question relative à cette facture, répondez simplement à cet e-mail.",
      "Bien cordialement,","Les Klosques",REPLY_TO
    ].join("\n");
    const html="<p>Bonjour,</p><p>Vous trouverez en pièce jointe votre facture <strong>"+
      safe(invoice.number)+"</strong> pour notre prestation musicale.</p>"+
      "<p>Date de la prestation : "+safe(invoice.data.event_date)+
      "<br>Échéance de paiement : "+safe(invoice.data.payment_due_date)+"</p>"+
      "<p>Pour toute question, répondez à cet e-mail.</p>"+
      "<p>Bien cordialement,<br><strong>Les Klosques</strong><br>"+safe(REPLY_TO)+"</p>";
    let receipt;
    try{
      receipt=await deliver(context.env,{
        to:recipient,subject,html,text,
        filename,attachment:encodePdfBase64(pdf)
      });
    }catch(error){
      console.warn("Échec fournisseur d'envoi facture",error?.message);
      return respond({error:"Le service de messagerie n'a pas accepté la facture. Aucun envoi n'est confirmé."},502);
    }
    let recorded=false;
    try{
      await DB.prepare("INSERT INTO invoice_email_sends (invoice_id,recipient,provider,message_id,sent_by) VALUES (?,?,?,?,?)")
        .bind(row.id,recipient,receipt.provider,receipt.id,user.email).run();
      recorded=true;
    }catch(error){console.warn("E-mail de facture accepté mais historique non enregistré",error?.message);}
    return respond({accepted:true,sent:true,recorded,number:invoice.number,recipient,
      message:"Le service de messagerie a accepté la facture et sa pièce jointe PDF."});
  }catch(error){
    console.warn("Préparation envoi facture impossible",error?.message);
    return respond({error:"Impossible de préparer l'envoi de cette facture."},503);
  }
}
