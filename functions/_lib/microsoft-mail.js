// Envoi de messages par le compte personnel Microsoft du groupe.
// Le destinataire n'a jamais besoin d'autoriser Klosques Manager.
// N'accepte les envois qu'après consentement OAuth explicite Mail.Send.
import {ensureIntegrationTables,getConnected,providerAccessToken,EXPECTED_OUTLOOK} from "./integrations.js";

const EMAIL=/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const MAILBOX=EXPECTED_OUTLOOK;
const validEmail=s=>typeof s==="string"&&s.length<=254&&EMAIL.test(s);

export async function microsoftMailReady(env){
  if(!env?.DB||!env?.MICROSOFT_CLIENT_ID||!env?.MICROSOFT_CLIENT_SECRET)return false;
  await ensureIntegrationTables(env.DB);
  const [connected,approval]=await Promise.all([
    getConnected(env.DB,"microsoft"),
    env.DB.prepare(
      "SELECT account_label FROM microsoft_mail_authorizations WHERE provider='microsoft'"
    ).first()
  ]);
  const allowed=String(env.OUTLOOK_EXPECTED_EMAIL||MAILBOX).trim().toLowerCase();
  return !!connected&&!!approval&&
    connected.account_label?.toLowerCase()===allowed&&
    approval.account_label?.toLowerCase()===allowed;
}

export async function sendMicrosoftMail(env,{to,subject,html,text,replyTo,attachment,filename,attachments,saveToSentItems=true}){
  if(!await microsoftMailReady(env))
    throw Error("Hotmail doit être connecté et réautorisé pour Mail.Send dans Site → Connexions.");
  if(!validEmail(to)||typeof subject!=="string"||!subject.trim()||subject.length>250)
    throw Error("Adresse e-mail ou objet invalide.");
  if(replyTo&&!validEmail(replyTo))throw Error("Adresse de réponse invalide.");
  if(typeof saveToSentItems!=="boolean")throw Error("Option de copie d'envoi invalide.");
  if(typeof html!=="string"||html.length>30000||
     typeof text!=="string"||text.length>30000)
    throw Error("Contenu du message invalide.");
  // Pour les devis et factures PDF, privilégier un message texte simple :
  // aucun style HTML ou lien non nécessaire dans la correspondance client.
  // Les alertes internes et les e-mails de test conservent leur présentation.
  // Cette présentation ne peut pas garantir un classement hors des spams.
  const documents=attachments===undefined?
    (attachment===undefined?[]:[{filename,content:attachment}]):attachments;
  if(!Array.isArray(documents)||documents.length>3)
    throw Error("Nombre de pièces jointes invalide.");
  let totalAttachmentSize=0;
  for(const file of documents){
    if(!file||typeof file.content!=="string"||file.content.length>6*1024*1024||
       !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)||
       typeof file.filename!=="string"||!file.filename.toLowerCase().endsWith(".pdf")||
       file.filename.length>100)throw Error("Pièce jointe PDF invalide.");
    totalAttachmentSize+=file.content.length;
  }
  if(totalAttachmentSize>7*1024*1024)
    throw Error("Pièces jointes PDF trop volumineuses.");
  const documentMail=documents.length>0;
  const message={
    subject,
    body:{contentType:documentMail?"Text":"HTML",content:documentMail?text:html},
    toRecipients:[{emailAddress:{address:to}}],
    ...(replyTo?{replyTo:[{emailAddress:{address:replyTo}}]}:{})
  };
  if(documents.length){
    message.attachments=documents.map(file=>({
      "@odata.type":"#microsoft.graph.fileAttachment",
      name:file.filename,contentType:"application/pdf",contentBytes:file.content
    }));
  }
  const token=await providerAccessToken(env,"microsoft");
  const response=await fetch("https://graph.microsoft.com/v1.0/me/sendMail",{
    method:"POST",
    headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify({message,saveToSentItems})
  });
  // Graph renvoie HTTP 202 sans ID. Il s'agit d'une acceptation,
  // pas d'une preuve de réception finale par le destinataire.
  if(response.status!==202){
    console.warn("Microsoft Graph sendMail refusé",response.status);
    if([401,403].includes(response.status))
      throw Error("Hotmail n'autorise pas l'envoi. Reconnecte LesKlosques@hotmail.com et accepte Mail.Send dans Site → Connexions.");
    throw Error("Hotmail n'a pas accepté l'envoi (code "+response.status+").");
  }
  return{provider:"microsoft",id:null,accepted:true};
}
