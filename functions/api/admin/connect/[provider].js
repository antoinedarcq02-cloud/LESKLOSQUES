import { authorize, respond } from "../../../_lib/admin-auth.js";
import {
  ensureIntegrationTables,randomBase64,pkceChallenge,oauthStartUrl
} from "../../../_lib/integrations.js";

// Les deux connexions appartiennent au groupe et sont autorisées par le responsable.
export async function onRequestGet(context){
  const user=await authorize(context);
  if(user.error)return user.error;
  if(user.user?.role!=="admin")
    return respond({error:"Connexion Google ou Outlook réservée au responsable."},403);
  const provider=context.params.provider;
  if(!["google","microsoft"].includes(provider))
    return respond({error:"Service inconnu."},404);
  try{
    const origin=new URL(context.request.url).origin;
    if(!origin.startsWith("https://"))return respond({error:"HTTPS obligatoire."},400);
    const DB=context.env.DB;
    await ensureIntegrationTables(DB);
    const state=randomBase64(32),verifier=randomBase64(48);
    const url=oauthStartUrl(context.env,provider,origin,state,await pkceChallenge(verifier));
    await DB.prepare("INSERT INTO oauth_connect_states(nonce,provider,code_verifier,started_by) VALUES(?,?,?,?)")
      .bind(state,provider,verifier,user.email).run();
    return new Response(null,{status:302,headers:{
      Location:url,"Cache-Control":"no-store",
      "Set-Cookie":"klosques_oauth_"+provider+"="+state+
        "; Path=/api/admin/connect/"+provider+"; Max-Age=600; Secure; HttpOnly; SameSite=Lax"
    }});
  }catch(error){
    console.warn("Connexion OAuth non initiée",provider,error?.message);
    return respond({error:"Configuration OAuth absente ou non disponible. Vérifie les identifiants du fournisseur dans Cloudflare."},503);
  }
}
