// Emails transactionnels des nouvelles demandes (indépendants de leur enregistrement).
// L'expéditeur doit appartenir à un domaine vérifié dans Resend.
// Aucun secret, ni donnée client, n'est exposé dans les réponses publiques.
const ADDRESS=/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export const GROUP_MAILBOX="LesKlosques@hotmail.com";
const safeText=v=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").trim();
const safeHtml=v=>safeText(v).replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

export function notificationRecipients(env){
  const configured=String(env?.BOOKING_NOTIFICATION_TO || GROUP_MAILBOX);
  const list=configured.split(/[;,]/).map(x=>x.trim()).filter(Boolean);
  return list.length>=1&&list.length<=4&&list.every(x=>ADDRESS.test(x)&&x.length<=254)
    ?[...new Set(list.map(x=>x.toLowerCase()))]:[];
}
export function bookingEmailStatus(env){
  const from=String(env?.RESEND_FROM_EMAIL || "").trim();
  const provider_ready=Boolean(env?.RESEND_API_KEY && ADDRESS.test(from));
  const recipients=notificationRecipients(env);
  const alerts_enabled=env?.BOOKING_ALERTS_ENABLED==="true";
  const receipt_enabled=env?.BOOKING_RECEIPT_ENABLED==="true";
  return {
    provider_ready,
    from_email:provider_ready?from:null,
    notification_to:recipients,
    alerts_enabled,
    receipt_enabled,
    alerts_ready:provider_ready&&alerts_enabled&&recipients.length>0,
    receipt_ready:provider_ready&&receipt_enabled
  };
}
export async function sendResendEmail(env,{to,subject,html,text,replyTo=GROUP_MAILBOX}){
  const ready=bookingEmailStatus(env);
  if(!ready.provider_ready)throw new Error("Expéditeur Resend non configuré.");
  if(!ADDRESS.test(to)||to.length>254)throw new Error("Destinataire invalide.");
  if(!ADDRESS.test(replyTo)||replyTo.length>254)throw new Error("Réponse invalide.");
  const response=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({
      from:"Les Klosques <"+ready.from_email+">",
      to:[to],reply_to:replyTo,subject,html,text
    })
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload?.id){
    console.warn("Resend : demande e-mail refusée",response.status,String(payload?.name||"").slice(0,50));
    throw new Error("Resend n'a pas accepté l'e-mail.");
  }
  return {provider:"resend",id:payload.id};
}
export async function ensureBookingEmailLog(DB){
  await DB.prepare(`CREATE TABLE IF NOT EXISTS booking_email_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('alerte_equipe','accuse_reception')),
    recipient TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('accepted','failed')),
    message_id TEXT,
    attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
}
export async function sendNewBookingEmails(env,bookingId,booking){
  const status=bookingEmailStatus(env);
  if(!status.alerts_ready&&!status.receipt_ready)return;
  await ensureBookingEmailLog(env.DB);
  const client=booking.name||"Organisateur";
  const fields=[
    ["Organisateur",client],["E-mail",booking.email],["Téléphone",booking.phone],
    ["Type d'événement",booking.eventType],["Date",booking.date],
    ["Lieu",booking.location],["Formule souhaitée",booking.package],
    ["Précisions",booking.message||"Aucune"]
  ];
  const groupText=fields.map(([k,v])=>k+" : "+safeText(v)).join("\n");
  const groupHtml=fields.map(([k,v])=>"<p><strong>"+safeHtml(k)+" :</strong> "+safeHtml(v)+"</p>").join("");
  const subject="Nouvelle demande Les Klosques — "+safeText(booking.date);
  const jobs=[];
  if(status.alerts_ready)for(const to of status.notification_to)jobs.push({
    category:"alerte_equipe",to,
    message:{to,subject,replyTo:booking.email,text:
      "Une nouvelle demande a été enregistrée dans Klosques Manager.\n\n"+
      groupText+"\n\nConsulter : https://lesklosques.pages.dev/admin/",
    html:"<h2>Nouvelle demande Les Klosques</h2>"+groupHtml+
      '<p><a href="https://lesklosques.pages.dev/admin/">Ouvrir Klosques Manager</a></p>'+
      "<p>Tu peux répondre directement à cet e-mail pour contacter l'organisateur.</p>"}
  });
  if(status.receipt_ready)jobs.push({
    category:"accuse_reception",to:booking.email,
    message:{to:booking.email,subject:"Nous avons bien reçu ta demande — Les Klosques",
      text:"Bonjour "+safeText(client)+",\n\nMerci pour ton message ! Nous avons bien reçu ta demande pour le "+
        safeText(booking.date)+" à "+safeText(booking.location)+
        ". Nous allons l'étudier et te répondre personnellement.\n\n"+
        "Ce message confirme uniquement la réception de ta demande : il ne constitue ni une réservation, ni un devis, ni une confirmation de disponibilité.\n\n"+
        "À bientôt !\nLes Klosques\n"+GROUP_MAILBOX,
      html:"<p>Bonjour "+safeHtml(client)+",</p>"+
        "<p>Merci pour ton message ! Nous avons bien reçu ta demande pour le <strong>"+
        safeHtml(booking.date)+"</strong> à <strong>"+safeHtml(booking.location)+
        "</strong>. Nous allons l'étudier et te répondre personnellement.</p>"+
        "<p><strong>Ce message confirme uniquement la réception de ta demande :</strong> "+
        "il ne constitue ni une réservation, ni un devis, ni une confirmation de disponibilité.</p>"+
        "<p>À bientôt !<br>Les Klosques<br>"+safeHtml(GROUP_MAILBOX)+"</p>"}
  });
  await Promise.all(jobs.map(async job=>{
    let receipt=null;
    try{
      receipt=await sendResendEmail(env,job.message);
    }catch(error){
      console.warn("Notification nouvelle demande non acceptée",job.category,error?.message);
    }
    try{
      await env.DB.prepare(`INSERT INTO booking_email_logs
        (booking_id,category,recipient,status,message_id) VALUES (?,?,?,?,?)`)
        .bind(bookingId,job.category,job.to,receipt?"accepted":"failed",receipt?.id||null).run();
    }catch(error){
      console.warn("Historique d'e-mail de nouvelle demande indisponible",error?.message);
    }
  }));
}
