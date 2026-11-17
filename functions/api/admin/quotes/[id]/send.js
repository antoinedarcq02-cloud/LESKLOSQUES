import { authorize, respond } from "../../../../_lib/admin-auth.js";
import { createQuotePdf, encodePdfBase64 } from "../../../../_lib/quote-pdf.js";
import { quoteMailReady, ensureQuoteEmailLog } from "../../../../_lib/quote-mail.js";
import {microsoftMailReady,sendMicrosoftMail} from "../../../../_lib/microsoft-mail.js";
import {getInvoiceRib} from "../../../../_lib/invoice-rib.js";

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const REPLY_TO = "LesKlosques@hotmail.com";

function safe(value){
  return String(value??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function quoteNumber(row){
  return "DEV-"+String(row.created_at).slice(0,4)+"-"+String(row.id).padStart(5,"0");
}
async function deliver(env,message){
  // Hotmail connecté : envoyer depuis LesKlosques@hotmail.com et enregistrer
  // une copie du message dans les éléments envoyés.
  if(await microsoftMailReady(env))return sendMicrosoftMail(env,message);
  if(!(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) && env.EMAIL && env.QUOTE_FROM_EMAIL){
    const result=await env.EMAIL.send({
      from:{name:"Les Klosques",email:env.QUOTE_FROM_EMAIL},to:message.to,
      replyTo:REPLY_TO,subject:message.subject,html:message.html,text:message.text,
      attachments:message.attachments.map(file=>({
        content:file.content,filename:file.filename,
        type:"application/pdf",disposition:"attachment"
      }))
    });
    if(!result?.messageId)throw new Error("Le service Cloudflare n'a pas confirmé l'envoi.");
    return {provider:"cloudflare",id:result.messageId};
  }
  const res=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+env.RESEND_API_KEY,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      from:"Les Klosques <"+env.RESEND_FROM_EMAIL+">",
      to:[message.to],reply_to:REPLY_TO,
      subject:message.subject,html:message.html,text:message.text,
      attachments:message.attachments.map(file=>({content:file.content,filename:file.filename}))
    })
  });
  const body=await res.json().catch(()=>({}));
  if(!res.ok || !body.id){
    console.warn("Refus du service email",res.status,body?.name||body?.error?.name||"");
    throw new Error("Le service de messagerie n'a pas accepté cet e-mail.");
  }
  return {provider:"resend",id:body.id};
}
export async function onRequestPost(context){
  const user=await authorize(context,true);
  if(user.error)return user.error;
  const idString=context.params.id;
  if(!/^[1-9]\d{0,14}$/.test(idString||"")||!Number.isSafeInteger(Number(idString)))
    return respond({error:"Numéro du devis invalide."},400);
  const id=Number(idString);
  let body;
  try{
    const input=await context.request.text();
    if(input.length>5000)return respond({error:"Confirmation trop longue."},413);
    body=JSON.parse(input);
  }catch{return respond({error:"Confirmation invalide."},400);}
  if(body?.confirm_send!==true)
    return respond({error:"Confirme explicitement l'envoi avant de continuer."},400);
  // Le destinataire est saisi ou confirmé par un membre depuis la boîte d'envoi.
  if(typeof body.recipient!=="string" || body.recipient.length>254 ||
     !EMAIL.test(body.recipient.trim()))
    return respond({error:"Saisis une seule adresse e-mail valide pour le destinataire."},400);
  const recipient=body.recipient.trim();
  if(body.personal_message!==undefined && typeof body.personal_message!=="string")
    return respond({error:"Le message personnel est invalide."},400);
  const personalMessage=String(body.personal_message||"").trim().replace(/\r\n?/g,"\n");
  if(personalMessage.length>2000)
    return respond({error:"Le message personnel ne doit pas dépasser 2 000 caractères."},400);
  if(!await quoteMailReady(context.env))
    return respond({error:"Envoi d'e-mails non configuré : un expéditeur vérifié et un service d'envoi sont nécessaires."},503);
  try{
    const DB=context.env.DB;
    const quote=await DB.prepare(
      "SELECT id,booking_id,data_json,status,created_at FROM official_quotes WHERE id=?"
    ).bind(id).first();
    if(!quote)return respond({error:"Devis introuvable."},404);
    if(quote.status!=="finalise")return respond({error:"Finalise le devis avant de l'envoyer."},409);
    // Un devis peut être indépendant : aucune demande client n'est requise.
    // Si une demande était liée, elle ne sert qu'au suivi du statut.
    const booking=quote.booking_id?await DB.prepare(
      "SELECT id,name,email,status FROM bookings WHERE id=?"
    ).bind(quote.booking_id).first():null;
    await ensureQuoteEmailLog(DB);
    const previous=await DB.prepare(
      "SELECT sent_at FROM quote_email_sends WHERE quote_id=? AND lower(recipient)=lower(?) ORDER BY id DESC LIMIT 1"
    ).bind(id,recipient).first();
    if(previous?.sent_at){
      const sent=Date.parse(previous.sent_at.replace(" ","T")+"Z");
      if(Number.isFinite(sent)&&Date.now()-sent<120000)
        return respond({error:"Ce devis vient d'être envoyé à cette adresse. Attends deux minutes avant un nouvel envoi."},429);
    }
    const mostRecent=await DB.prepare(
      "SELECT sent_at FROM quote_email_sends WHERE quote_id=? ORDER BY id DESC LIMIT 1"
    ).bind(id).first();
    if(mostRecent?.sent_at){
      const sent=Date.parse(mostRecent.sent_at.replace(" ","T")+"Z");
      if(Number.isFinite(sent)&&Date.now()-sent<15000)
        return respond({error:"Un envoi vient d'être effectué pour ce devis. Patiente quelques secondes avant de le renvoyer."},429);
    }
    // Envoyer le devis et le RIB dans un seul e-mail, sans jamais exposer
    // le document bancaire dans les fichiers publics du site.
    const rib=await getInvoiceRib(DB);
    if(!rib)return respond({
      error:"RIB non configuré : le gestionnaire doit l’ajouter dans Site → RIB à joindre aux devis et factures avant l’envoi.",
      rib_missing:true
    },409);
    const data=JSON.parse(quote.data_json);
    const number=quoteNumber(quote);
    const pdf=createQuotePdf({number,data});
    if(pdf.byteLength>4*1024*1024)
      return respond({error:"Le PDF du devis dépasse la taille maximale autorisée."},413);
    const filename=number+".pdf";
    const attachments=[
      {filename,content:encodePdfBase64(pdf)},
      {filename:rib.filename,content:rib.content}
    ];
    const lines=[
      "Bonjour,",
      "",
      "Vous trouverez en pièces jointes notre devis "+number+
        " concernant votre événement, accompagné du RIB de l’association Happy Live 66.",
      "Date prévue : "+(data.event_date||"à préciser"),
      "Lieu : "+(data.event_location||"à préciser"),
      "",
      ...(personalMessage?[personalMessage,""]:[]),
      "Merci de nous confirmer par retour d'e-mail si vous acceptez ce devis, ou de nous contacter pour toute question.",
      "",
      "Bien cordialement,",
      "Les Klosques",
      REPLY_TO
    ];
    const subject="Votre devis Les Klosques - "+number;
    const html="<p>Bonjour,</p><p>Vous trouverez en pièces jointes notre devis <strong>"+
      safe(number)+"</strong> concernant votre événement, accompagné du RIB de l’association Happy Live 66.</p><p>Date prévue : "+
      safe(data.event_date||"à préciser")+"<br>Lieu : "+safe(data.event_location||"à préciser")+
      "</p>"+(personalMessage?"<p>"+safe(personalMessage).replace(/\n/g,"<br>")+"</p>":"")+
      "<p>Merci de nous confirmer par retour d'e-mail si vous acceptez ce devis, ou de nous contacter pour toute question.</p>"+
      "<p>Bien cordialement,<br><strong>Les Klosques</strong><br>"+
      safe(REPLY_TO)+"</p>";
    let receipt;
    try{
      receipt=await deliver(context.env,{
        to:recipient,subject,html,text:lines.join("\n"),
        attachments
      });
    }catch(error){
      console.warn("Envoi refusé",error?.message);
      return respond({error:"L'e-mail n'a pas été accepté par le service d'envoi. Vérifie la configuration et réessaie."},502);
    }
    // Le fournisseur a accepté le message. Une erreur de journalisation ne
    // doit jamais faire croire qu'il faut le renvoyer immédiatement.
    let recorded=false, statusUpdated=false;
    try{
      await DB.prepare(
        "INSERT INTO quote_email_sends (quote_id,recipient,provider,message_id,sent_by) VALUES (?,?,?,?,?)"
      ).bind(id,recipient,receipt.provider,receipt.id,user.email).run();
      recorded=true;
    }catch(error){console.warn("Envoi accepté, journalisation échouée",error?.message);}
    // N'indiquer « devis envoyé » dans la demande que si le destinataire
    // est son client. Un test envoyé à un membre ne valide pas son envoi.
    if(booking?.email?.trim().toLowerCase()===recipient.toLowerCase()){
      try{
        // Ne pas déclasser un concert confirmé, en option, terminé ou refusé.
        await DB.prepare(
          "UPDATE bookings SET status='devis_envoye',updated_at=datetime('now'),updated_by=? WHERE id=? AND status IN ('nouveau','en_discussion')"
        ).bind(user.email,booking.id).run();
        statusUpdated=true;
      }catch(error){console.warn("Envoi accepté, statut non actualisé",error?.message);}
    }
    return respond({
      sent:true,accepted:true,recipient,number,
      recorded,status_updated:statusUpdated,
      attachments:[filename,rib.filename],
      message:"Le service de messagerie a accepté le devis PDF et le RIB Happy Live 66 PDF."
    });
  }catch(error){
    console.warn("Erreur préparation de l'envoi du devis",error?.message);
    return respond({error:"Impossible de préparer cet envoi pour le moment."},503);
  }
}
