import { authorize, respond } from "../../../../_lib/admin-auth.js";
import { createQuotePdf, encodePdfBase64 } from "../../../../_lib/quote-pdf.js";
import { quoteMailReady, ensureQuoteEmailLog } from "../../../../_lib/quote-mail.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  if(env.EMAIL && env.QUOTE_FROM_EMAIL){
    const result=await env.EMAIL.send({
      from:{name:"Les Klosques",email:env.QUOTE_FROM_EMAIL},to:message.to,
      replyTo:REPLY_TO,subject:message.subject,html:message.html,text:message.text,
      attachments:[{content:message.attachment,filename:message.filename,type:"application/pdf",disposition:"attachment"}]
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
      attachments:[{content:message.attachment,filename:message.filename}]
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
    if(input.length>1000)return respond({error:"Confirmation trop longue."},413);
    body=JSON.parse(input);
  }catch{return respond({error:"Confirmation invalide."},400);}
  if(body?.confirm_send!==true)
    return respond({error:"Confirme explicitement l'envoi avant de continuer."},400);
  if(!quoteMailReady(context.env))
    return respond({error:"Envoi d'e-mails non configuré : un expéditeur vérifié et un service d'envoi sont nécessaires."},503);
  try{
    const DB=context.env.DB;
    const quote=await DB.prepare(
      "SELECT id,booking_id,data_json,status,created_at FROM official_quotes WHERE id=?"
    ).bind(id).first();
    if(!quote)return respond({error:"Devis introuvable."},404);
    if(quote.status!=="finalise")return respond({error:"Finalise le devis avant de l'envoyer."},409);
    // L'adresse vient UNIQUEMENT de la demande initiale enregistrée dans D1.
    if(!quote.booking_id)return respond({error:"Associe d'abord ce devis à une demande client avec adresse e-mail."},409);
    const booking=await DB.prepare(
      "SELECT id,name,email,status FROM bookings WHERE id=?"
    ).bind(quote.booking_id).first();
    if(!booking)return respond({error:"La demande client associée n'existe plus."},409);
    const recipient=String(booking.email||"").trim();
    if(!EMAIL.test(recipient)||recipient.length>254)
      return respond({error:"L'adresse e-mail renseignée dans la demande est invalide ou manquante."},409);
    await ensureQuoteEmailLog(DB);
    const previous=await DB.prepare(
      "SELECT sent_at FROM quote_email_sends WHERE quote_id=? AND recipient=? ORDER BY id DESC LIMIT 1"
    ).bind(id,recipient).first();
    if(previous?.sent_at){
      const sent=Date.parse(previous.sent_at.replace(" ","T")+"Z");
      if(Number.isFinite(sent)&&Date.now()-sent<120000)
        return respond({error:"Ce devis vient d'être envoyé à ce client. Attends deux minutes avant un nouvel envoi."},429);
    }
    const data=JSON.parse(quote.data_json);
    const number=quoteNumber(quote);
    const pdf=createQuotePdf({number,data});
    if(pdf.byteLength>4*1024*1024)
      return respond({error:"Le PDF du devis dépasse la taille maximale autorisée."},413);
    const lines=[
      "Bonjour,",
      "",
      "Vous trouverez en pièce jointe notre devis "+number+" concernant votre événement.",
      "Date prévue : "+(data.event_date||"à préciser"),
      "Lieu : "+(data.event_location||"à préciser"),
      "",
      "Merci de nous confirmer par retour d'e-mail si vous acceptez ce devis, ou de nous contacter pour toute question.",
      "",
      "Bien cordialement,",
      "Les Klosques",
      REPLY_TO
    ];
    const subject="Votre devis Les Klosques - "+number;
    const html="<p>Bonjour,</p><p>Vous trouverez en pièce jointe notre devis <strong>"+
      safe(number)+"</strong> concernant votre événement.</p><p>Date prévue : "+
      safe(data.event_date||"à préciser")+"<br>Lieu : "+safe(data.event_location||"à préciser")+
      "</p><p>Merci de nous confirmer par retour d'e-mail si vous acceptez ce devis, ou de nous contacter pour toute question.</p>"+
      "<p>Bien cordialement,<br><strong>Les Klosques</strong><br>"+
      safe(REPLY_TO)+"</p>";
    let receipt;
    try{
      receipt=await deliver(context.env,{
        to:recipient,subject,html,text:lines.join("\n"),
        attachment:encodePdfBase64(pdf),filename:number+".pdf"
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
    try{
      // Ne pas déclasser un concert confirmé, en option, terminé ou refusé.
      await DB.prepare(
        "UPDATE bookings SET status='devis_envoye',updated_at=datetime('now'),updated_by=? WHERE id=? AND status IN ('nouveau','en_discussion')"
      ).bind(user.email,booking.id).run();
      statusUpdated=true;
    }catch(error){console.warn("Envoi accepté, statut non actualisé",error?.message);}
    return respond({
      sent:true,accepted:true,recipient,number,
      recorded,status_updated:statusUpdated,
      message:"Le service de messagerie a accepté l'e-mail avec le devis PDF en pièce jointe."
    });
  }catch(error){
    console.warn("Erreur préparation de l'envoi du devis",error?.message);
    return respond({error:"Impossible de préparer cet envoi pour le moment."},503);
  }
}
