import { constantEquals, respond } from "../../../../_lib/admin-auth.js";
import {
  ensureIntegrationTables,integrationConfig,callbackUrl,validOauthState,
  saveConnected,EXPECTED_OUTLOOK
} from "../../../../_lib/integrations.js";

function cookieValue(request,name){
  return (request.headers.get("Cookie")||"").split(";").map(s=>s.trim())
    .find(s=>s.startsWith(name+"="))?.slice(name.length+1)||"";
}
function finish(origin,provider,outcome){
  return new Response(null,{status:303,headers:{
    Location:origin+"/admin/?connexion="+encodeURIComponent(provider+"-"+outcome),
    "Cache-Control":"no-store",
    "Set-Cookie":"klosques_oauth_"+provider+"=; Path=/api/admin/connect/"+provider+
      "; Max-Age=0; Secure; HttpOnly; SameSite=Lax"
  }});
}
export async function onRequestGet(context){
  const provider=context.params.provider;
  if(!["google","microsoft"].includes(provider))
    return respond({error:"Service inconnu."},404);
  const url=new URL(context.request.url),origin=url.origin;
  if(!origin.startsWith("https://"))return respond({error:"HTTPS obligatoire."},400);
  const state=url.searchParams.get("state")||"";
  const csrf=cookieValue(context.request,"klosques_oauth_"+provider);
  if(!validOauthState(state)||!constantEquals(state,csrf))
    return finish(origin,provider,provider==="microsoft"?"session":"erreur");
  try{
    const DB=context.env.DB;
    await ensureIntegrationTables(DB);
    // One-time-use: le nonce est consommé avant tout appel réseau.
    const pending=await DB.prepare(
      "SELECT provider,code_verifier,started_by FROM oauth_connect_states WHERE nonce=? AND provider=? AND created_at>=datetime('now','-10 minutes')"
    ).bind(state,provider).first();
    if(!pending)return finish(origin,provider,"expire");
    const deleted=await DB.prepare(
      "DELETE FROM oauth_connect_states WHERE nonce=? AND provider=? AND created_at>=datetime('now','-10 minutes')"
    ).bind(state,provider).run();
    if(!deleted.meta?.changes)return finish(origin,provider,"expire");
    if(url.searchParams.has("error"))return finish(origin,provider,"refuse");
    const code=url.searchParams.get("code")||"";
    if(!code||code.length>8192)return finish(origin,provider,"erreur");
    const config=integrationConfig(context.env,provider);
    if(!config.id||!config.secret)return finish(origin,provider,"configuration");
    const params=new URLSearchParams({
      client_id:config.id,client_secret:config.secret,code,
      grant_type:"authorization_code",redirect_uri:callbackUrl(origin,provider),
      code_verifier:pending.code_verifier
    });
    if(provider==="microsoft")params.set("scope",config.scopes);
    const response=await fetch(config.token,{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:params.toString()
    });
    const tokens=await response.json().catch(()=>({}));
    if(!response.ok||!tokens.refresh_token||!tokens.access_token){
      // Les identifiants et les détails OAuth restent confidentiels.
      // Seuls le type d'erreur et les codes Microsoft sont journalisés.
      const errorType=typeof tokens.error==="string"?tokens.error.slice(0,60):"inconnu";
      const errorCodes=Array.isArray(tokens.error_codes)?tokens.error_codes
        .filter(n=>Number.isInteger(n)).slice(0,5):[];
      console.warn("Échange de jeton OAuth refusé",provider,response.status,errorType,errorCodes.join(","));
      if(provider==="microsoft"){
        const badSecret=errorType==="invalid_client"||
          errorCodes.some(n=>[70002,7000215,7000222].includes(n));
        return finish(origin,provider,badSecret?"identifiants":
          !tokens.refresh_token&&!!tokens.access_token?"renouvellement":"jeton");
      }
      return finish(origin,provider,"erreur");
    }
    // La permission Mail.Send est obligatoire pour autoriser les envois
    // depuis le compte du groupe. Un jeton déjà connecté en lecture seule
    // ne donne jamais le droit d'envoyer des messages.
    if(provider==="microsoft"&&typeof tokens.scope==="string"&&
       !tokens.scope.split(/\s+/).some(scope=>scope.toLowerCase()==="mail.send"))
      return finish(origin,provider,"permissions");
    let label="Google Agenda";
    if(provider==="microsoft"){
      const profileResponse=await fetch(
        "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName",{
          headers:{Authorization:"Bearer "+tokens.access_token}
        }
      );
      if(!profileResponse.ok){
        console.warn("Lecture du profil Microsoft refusée",profileResponse.status);
        return finish(origin,provider,"profil");
      }
      const profile=await profileResponse.json().catch(()=>({}));
      const allowed=String(context.env.OUTLOOK_EXPECTED_EMAIL||EXPECTED_OUTLOOK).trim().toLowerCase();
      const identities=[profile.mail,profile.userPrincipalName]
        .filter(x=>typeof x==="string").map(x=>x.toLowerCase());
      if(!identities.includes(allowed))
        return finish(origin,provider,"mauvais-compte");
      label=allowed;
    }
    await saveConnected(context.env,provider,tokens.refresh_token,label,pending.started_by);
    if(provider==="microsoft"){
      // Le consentement à l'envoi ne peut provenir que d'une connexion
      // Microsoft refaite avec les nouvelles permissions.
      await DB.prepare(
        "INSERT INTO microsoft_mail_authorizations(provider,account_label) VALUES('microsoft',?) "+
        "ON CONFLICT(provider) DO UPDATE SET account_label=excluded.account_label,authorized_at=datetime('now')"
      ).bind(label).run();
    }
    return finish(origin,provider,"ok");
  }catch(error){
    console.warn("Échec de connexion OAuth",provider,error?.message);
    return finish(origin,provider,"erreur");
  }
}
