// Seuls ces deux calendriers partagés des Klosques sont autorisés.
// Jamais de repli silencieux vers "primary" (agenda personnel Google).
const GROUP_NAMES=Object.freeze({
  concerts:"KLOSQUES PARTAGE",
  unavailable:"KLOSQUES PAS DISPO PARTAGE"
});
const compact=value=>String(value||"").trim().replace(/\s+/g," ").toLocaleUpperCase("fr-FR");
const matches=(entry,expected)=>[entry.summary,entry.summaryOverride]
  .some(name=>compact(name)===compact(expected));

export async function resolveKlosquesCalendars(env,accessToken){
  if(!accessToken)throw Error("Connexion Google absente.");
  const entries=[];
  let pageToken="",page=0;
  do{
    const search=new URLSearchParams({maxResults:"250",showHidden:"true"});
    if(pageToken)search.set("pageToken",pageToken);
    const result=await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?"+search.toString(),
      {headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"}}
    );
    if(result.status===403)
      throw Error("Autorisation de lecture de la liste des agendas manquante : reconnecte Google Agenda depuis Site.");
    if(!result.ok)throw Error("Impossible de consulter la liste des agendas partagés Google.");
    const data=await result.json().catch(()=>({}));
    entries.push(...(Array.isArray(data.items)?data.items:[]));
    pageToken=typeof data.nextPageToken==="string"?data.nextPageToken:"";
    page++;
  }while(pageToken&&page<6);
  if(pageToken)throw Error("Liste Google trop longue : sélection des agendas impossible.");

  const selected={};
  for(const [kind,name] of Object.entries(GROUP_NAMES)){
    const possible=entries.filter(item=>item&&item.deleted!==true&&item.id&&matches(item,name));
    const key=kind==="concerts"?"GOOGLE_KLOSQUES_CALENDAR_ID":"GOOGLE_KLOSQUES_UNAVAILABLE_CALENDAR_ID";
    const specified=String(env[key]||"").trim();
    const narrowed=specified?possible.filter(c=>c.id===specified):possible;
    if(narrowed.length!==1){
      const reason=narrowed.length>1?"Plusieurs agendas portent ce nom.":"Agenda partagé non trouvé ou non accessible.";
      throw Error(reason+" Vérifie \""+name+"\" dans Google Agenda.");
    }
    selected[kind]={id:String(narrowed[0].id),name,accessRole:String(narrowed[0].accessRole||"")};
  }
  if(selected.concerts.id===selected.unavailable.id)
    throw Error("Les deux agendas Klosques doivent être distincts.");
  return selected;
}
