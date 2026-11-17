import {authorize,respond} from "../../_lib/admin-auth.js";
import {ensureIntegrationTables,getConnected,providerAccessToken} from "../../_lib/integrations.js";

// Lecture seule : aucun marquage comme lu, aucune suppression, aucun envoi.
export async function onRequestGet(context){
  const user=await authorize(context);
  if(user.error)return user.error;
  if(!["admin","member"].includes(user.user?.role))
    return respond({error:"Boîte mail réservée aux musiciens du groupe."},403);
  try{
    const DB=context.env.DB;
    await ensureIntegrationTables(DB);
    const link=await getConnected(DB,"microsoft");
    if(!link)return respond({connected:false,messages:[]});
    const token=await providerAccessToken(context.env,"microsoft");
    const params=new URLSearchParams({
      "$top":"20",
      "$select":"id,subject,receivedDateTime,from,bodyPreview,webLink,isRead",
      "$orderby":"receivedDateTime desc"
    });
    const endpoint="https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?"+params.toString();
    const response=await fetch(endpoint,{headers:{
      Authorization:"Bearer "+token,Accept:"application/json"
    }});
    if(!response.ok)throw Error("Lecture Graph refusée "+response.status);
    const result=await response.json();
    const messages=(result.value||[]).slice(0,20).map(m=>({
      id:String(m.id||"").slice(0,500),
      subject:String(m.subject||"(Sans objet)").slice(0,200),
      from_name:String(m.from?.emailAddress?.name||"").slice(0,120),
      from_address:String(m.from?.emailAddress?.address||"").slice(0,254),
      preview:String(m.bodyPreview||"").slice(0,280),
      received_at:String(m.receivedDateTime||"").slice(0,40),
      unread:m.isRead===false,
      web_url:typeof m.webLink==="string"&&
        /^https:\/\/outlook\.(?:live|office|office365)\.com\//i.test(m.webLink)
        ?m.webLink.slice(0,1800):null
    }));
    return respond({connected:true,account:link.account_label,messages});
  }catch(error){
    console.warn("Accès boîte Outlook indisponible",error?.message);
    return respond({error:"Impossible de lire la boîte Hotmail. Demande au gestionnaire de vérifier la connexion Outlook dans Site."},503);
  }
}
