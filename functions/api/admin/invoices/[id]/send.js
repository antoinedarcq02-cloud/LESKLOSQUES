import { authorize, respond } from "../../../../_lib/admin-auth.js";
import { ensureInvoiceTables, publicInvoice, validInvoiceId } from "../../../../_lib/invoice-core.js";
import { createInvoicePdf, encodePdfBase64 } from "../../../../_lib/invoice-pdf.js";
import { quoteMailReady } from "../../../../_lib/quote-mail.js";
import {microsoftMailReady,sendMicrosoftMail} from "../../../../_lib/microsoft-mail.js";
import {getInvoiceRib} from "../../../../_lib/invoice-rib.js";

const EMAIL=/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const REPLY_TO="LesKlosques@hotmail.com";
function safe(s){
  return String(s??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
async function deliver(env,mail){
  if(await microsoftMailReady(env))return sendMicrosoftMail(env,mail);
  if(!(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) && env.EMAIL && env.QUOTE_FROM_EMAIL){
    const result=await env.EMAIL.send({
      from:{name:"Les Klosques",email:env.QUOTE_FROM_EMAIL},
      to:mail.to,replyTo:REPLY_TO,subject:mail.subject,
      html:mail.html,text:mail.text,
      attachments:mail.attachments.map(file=>({
        content:file.content,filename:file.filename,
        type:"application/pdf",disposition:"attachment"
      }))
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
      attachments:mail.attachments.map(file=>({
        content:file.content,filename:file.filename
      }))
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
    if(raw.length>5000)return respond({error:"Confirmation trop longue."},413);
    body=JSON.parse(raw);
  }catch{return respond({error:"Confirmation invalide."},400);}
  if(body?.confirm_send!==true)return respond({error:"Confirmation explicite requise avant l'envoi."},400);
  if(typeof body.recipient!=="string"||body.recipient.length>254||!EMAIL.test(body.recipient.trim()))
    return respond({error:"Renseigne une seule adresse e-mail de destinataire valide."},400);
  const recipient=body.recipient.trim();
  if(body.personal_message!==undefined && typeof body.personal_message!=="string")
    return respond({error:"Le message personnel est invalide."},400);
  const personalMessage=String(body.personal_message||"").trim().replace(/\r\n?/g,"\n");
  if(personalMessage.length>2000)
    return respond({error:"Le message personnel ne doit pas dépasser 2 000 caractères."},400);
  if(!await quoteMailReady(context.env))
    return respond({error:"Envoi non configuré : il faut une adresse d'expédition vérifiée et un service d'e-mail."},503);
  const DB=context.env.DB;
  try{
    await ensureInvoiceTables(DB);
    const row=await DB.prepare("SELECT * FROM official_invoices WHERE id=?").bind(context.params.id).first();
    if(!row)return respond({error:"Facture introuvable."},404);
    if(row.status!=="emise")return respond({error:"Émets la facture avant l'envoi."},409);
    const invoice=publicInvoice(row);
    // Le destinataire est confirmé par le musicien ; une facture peut
    // n'être liée à aucune demande client ou être transmise à une adresse
    // communiquée après sa finalisation.
    const previous=await DB.prepare(
      "SELECT sent_at FROM invoice_email_sends WHERE invoice_id=? AND lower(recipient)=lower(?) ORDER BY id DESC LIMIT 1"
    ).bind(row.id,recipient).first();
    if(previous?.sent_at){
      const stamp=Date.parse(previous.sent_at.replace(" ","T")+"Z");
      if(Number.isFinite(stamp)&&Date.now()-stamp<120000)
        return respond({error:"Cette facture vient d'être envoyée à cette adresse. Attends deux minutes avant de la renvoyer."},429);
    }
    const recent=await DB.prepare(
      "SELECT sent_at FROM invoice_email_sends WHERE invoice_id=? ORDER BY id DESC LIMIT 1"
    ).bind(row.id).first();
    if(recent?.sent_at){
      const stamp=Date.parse(recent.sent_at.replace(" ","T")+"Z");
      if(Number.isFinite(stamp)&&Date.now()-stamp<15000)
        return respond({error:"Un envoi vient d'être effectué pour cette facture. Patiente quelques secondes."},429);
    }
    // Garantir l'envoi en une seule opération des deux PDF.
    // En cas de RIB absent, bloquer AVANT d'appeler un fournisseur d'e-mail.
    const rib=await getInvoiceRib(DB);
    if(!rib)return respond({
      error:"RIB non configuré : le gestionnaire doit l'ajouter dans Site → RIB à joindre aux devis et factures avant l'envoi.",
      rib_missing:true
    },409);
    const pdf=createInvoicePdf(invoice);
    if(pdf.length>4*1024*1024)return respond({error:"Le PDF dépasse la taille autorisée."},413);
    const filename=invoice.number+".pdf";
    const attachments=[
      {filename,content:encodePdfBase64(pdf)},
      {filename:rib.filename,content:rib.content}
    ];
    const subject="Votre facture Les Klosques - "+invoice.number;
    const text=[
      "Bonjour,","","Vous trouverez en pièces jointes votre facture "+invoice.number+
        " pour notre prestation musicale, ainsi que notre RIB Happy Live 66.",
      "Date de la prestation : "+(invoice.data.event_date||"à préciser"),
      "Échéance de paiement : "+(invoice.data.payment_due_date||"à préciser"),
      "",
      ...(personalMessage?[personalMessage,""]:[]),
      "Pour toute question relative à cette facture, répondez simplement à cet e-mail.",
      "Bien cordialement,","Les Klosques",REPLY_TO
    ].join("\n");
    const html="<p>Bonjour,</p><p>Vous trouverez en pièces jointes votre facture <strong>"+
      safe(invoice.number)+"</strong> pour notre prestation musicale, ainsi que notre RIB Happy Live 66.</p>"+
      "<p>Date de la prestation : "+safe(invoice.data.event_date)+
      "<br>Échéance de paiement : "+safe(invoice.data.payment_due_date)+"</p>"+
      (personalMessage?"<p>"+safe(personalMessage).replace(/\n/g,"<br>")+"</p>":"")+
      "<p>Pour toute question, répondez à cet e-mail.</p>"+
      "<p>Bien cordialement,<br><strong>Les Klosques</strong><br>"+safe(REPLY_TO)+"</p>";
    let receipt;
    try{
      receipt=await deliver(context.env,{
        to:recipient,subject,html,text,attachments
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
      attachments:[filename,rib.filename],
      message:"Le service de messagerie a accepté la facture PDF et le RIB PDF."});
  }catch(error){
    console.warn("Préparation envoi facture impossible",error?.message);
    return respond({error:"Impossible de préparer l'envoi de cette facture."},503);
  }
}
