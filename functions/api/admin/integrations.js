import {authorize,respond} from "../../_lib/admin-auth.js";
import {microsoftMailReady} from "../../_lib/microsoft-mail.js";
import {
  ensureIntegrationTables,getConnected,integrationConfig
} from "../../_lib/integrations.js";

async function checkAdmin(context,write=false){
  const user=await authorize(context,write);
  if(user.error)return user;
  if(user.user?.role!=="admin")return{error:respond({error:"Action réservée au responsable."},403)};
  return user;
}
export async function onRequestGet(context){
  const user=await checkAdmin(context);
  if(user.error)return user.error;
  try{
    await ensureIntegrationTables(context.env.DB);
    const [google,microsoft]=await Promise.all([
      getConnected(context.env.DB,"google"),getConnected(context.env.DB,"microsoft")
    ]);
    const g=integrationConfig(context.env,"google");
    const m=integrationConfig(context.env,"microsoft");
    const sending=await microsoftMailReady(context.env);
    return respond({
      google:{
        configured:!!(g.id&&g.secret),
        connected:!!google||!!context.env.GOOGLE_REFRESH_TOKEN,
        label:google?.account_label||null,
        legacy:!google&&!!context.env.GOOGLE_REFRESH_TOKEN
      },
      microsoft:{
        configured:!!(m.id&&m.secret),
        connected:!!microsoft,
        label:microsoft?.account_label||null,
        sending_enabled:sending
      }
    });
  }catch(error){
    console.warn("État des connexions non disponible",error?.message);
    return respond({error:"Impossible de consulter les connexions."},503);
  }
}
export async function onRequestPost(context){
  const user=await checkAdmin(context,true);
  if(user.error)return user.error;
  let payload;
  try{const body=await context.request.text();if(body.length>300)return respond({error:"Requête trop longue."},413);
    payload=JSON.parse(body);
  }catch{return respond({error:"Requête invalide."},400);}
  if(payload?.action!=="disconnect"||!["google","microsoft"].includes(payload.provider)||payload.confirm!==true)
    return respond({error:"Déconnexion non confirmée."},400);
  try{
    await ensureIntegrationTables(context.env.DB);
    await context.env.DB.prepare("DELETE FROM connected_services WHERE provider=?").bind(payload.provider).run();
    if(payload.provider==="microsoft")
      await context.env.DB.prepare("DELETE FROM microsoft_mail_authorizations WHERE provider='microsoft'").run();
    // Un éventuel ancien jeton Google stocké comme secret Cloudflare reste actif.
    const legacy_remains=payload.provider==="google"&&!!context.env.GOOGLE_REFRESH_TOKEN;
    // Les concerts ajoutés dans Google et les messages Outlook ne sont pas supprimés.
    return respond({ok:true,disconnected:!legacy_remains,legacy_remains});
  }catch(error){
    console.warn("Déconnexion impossible",error?.message);
    return respond({error:"Impossible de déconnecter le compte."},503);
  }
}
