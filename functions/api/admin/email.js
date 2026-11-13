import { authorize, respond } from "../../_lib/admin-auth.js";
import { GROUP_MAILBOX, bookingEmailStatus, sendResendEmail } from "../../_lib/booking-email.js";

// Paramétrage exclusivement dans les secrets Cloudflare ; aucune clé exposée.
// Le test est expédié uniquement vers l'adresse d'alerte configurée.
async function ensureTestTable(DB){
  await DB.prepare(`CREATE TABLE IF NOT EXISTS admin_email_test (
    slot INTEGER PRIMARY KEY CHECK(slot=1),
    last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_accepted_at TEXT,
    last_message_id TEXT
  )`).run();
}
async function adminAccess(context,write=false){
  const access=await authorize(context,write);
  if(access.error)return {error:access.error};
  if(access.user?.role!=="admin")
    return {error:respond({error:"Réservé au responsable de Klosques Manager."},403)};
  return access;
}
export async function onRequestGet(context){
  const user=await adminAccess(context);
  if(user.error)return user.error;
  try{
    await ensureTestTable(context.env.DB);
    const status=bookingEmailStatus(context.env);
    const test=await context.env.DB.prepare(
      "SELECT last_accepted_at FROM admin_email_test WHERE slot=1"
    ).first();
    return respond({
      ...status,
      documents_ready:Boolean(
        (context.env.RESEND_API_KEY && context.env.RESEND_FROM_EMAIL) ||
        (context.env.EMAIL && context.env.QUOTE_FROM_EMAIL)
      ),
      last_test_accepted_at:test?.last_accepted_at||null
    });
  }catch(error){
    console.warn("État messagerie non disponible",error?.message);
    return respond({error:"Impossible de vérifier la configuration e-mail."},503);
  }
}
export async function onRequestPost(context){
  const user=await adminAccess(context,true);
  if(user.error)return user.error;
  let payload;
  try{
    const raw=await context.request.text();
    if(raw.length>250)return respond({error:"Confirmation trop longue."},413);
    payload=JSON.parse(raw);
  }catch{return respond({error:"Confirmation invalide."},400);}
  if(payload?.action!=="test_email"||payload?.confirmed!==true)
    return respond({error:"Confirme l'envoi de l'e-mail de test."},400);
  const status=bookingEmailStatus(context.env);
  if(!status.provider_ready)
    return respond({error:"Resend n'est pas configuré. Ajoute d'abord RESEND_API_KEY et RESEND_FROM_EMAIL dans Cloudflare."},503);
  const recipient=status.notification_to[0];
  if(!recipient)return respond({error:"Adresse BOOKING_NOTIFICATION_TO incorrecte."},400);
  try{
    const DB=context.env.DB;
    await ensureTestTable(DB);
    const throttle=await DB.prepare(`INSERT INTO admin_email_test(slot,last_attempt_at)
      VALUES(1,datetime('now'))
      ON CONFLICT(slot) DO UPDATE SET last_attempt_at=excluded.last_attempt_at
      WHERE admin_email_test.last_attempt_at<=datetime('now','-2 minutes')`).run();
    if(!throttle.meta?.changes)
      return respond({error:"Un test a déjà été demandé récemment. Réessaie dans deux minutes."},429);
    const receipt=await sendResendEmail(context.env,{
      to:recipient,subject:"Test de messagerie — Klosques Manager",replyTo:GROUP_MAILBOX,
      text:"Test demandé par "+user.email+
        " depuis Klosques Manager. Aucun devis ni aucune facture n'a été transmis.",
      html:"<h2>Test de messagerie Klosques Manager</h2>"+
        "<p>Aucun devis ni aucune facture n'a été transmis par ce test.</p>"+
        "<p>Les Klosques</p>"
    });
    try{
      await DB.prepare(`UPDATE admin_email_test SET last_accepted_at=datetime('now'),
        last_message_id=? WHERE slot=1`).bind(receipt.id).run();
    }catch(error){console.warn("Historique test email non enregistré",error?.message);}
    return respond({ok:true,accepted:true,recipient,
      message:"Le service Resend a accepté l'e-mail de test. Vérifie la boîte de réception et les courriers indésirables."});
  }catch(error){
    console.warn("Test de messagerie refusé",error?.message);
    return respond({error:"L'envoi de test a échoué. Vérifie le domaine d'envoi et les variables Cloudflare."},502);
  }
}
