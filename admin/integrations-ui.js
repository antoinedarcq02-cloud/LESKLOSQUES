'use strict';

// Connexions serveur : aucune clé ni jeton OAuth n'est affiché ou conservé
// par le navigateur. Les messages restent en lecture seule.
let externalServices={google:null,microsoft:null};
function itemRow(title,details,tag){
  const row=document.createElement('div');row.className='external-item';
  const heading=document.createElement('strong');heading.textContent=title;
  const info=document.createElement('p');info.textContent=details||'';info.className='muted small';
  row.append(heading,info);
  if(tag){const badge=document.createElement('span');badge.className='external-status';badge.textContent=tag;row.appendChild(badge);}
  return row;
}
async function loadExternalConnections(){
  if(!state.logged||state.role!=='admin')return;
  const root=$('externalConnectionsStatus');
  try{
    const data=await callApi('/api/admin/integrations');
    externalServices=data;
    root.replaceChildren();
    const google=data.google,microsoft=data.microsoft;
    root.append(
      itemRow('Google Agenda',google.connected?
        (google.legacy?'Connecté via les variables Cloudflare':'Compte autorisé dans le Manager'):
        google.configured?'Prêt à être connecté':'Identifiants OAuth à configurer dans Cloudflare',
        google.connected?'Connecté':'Non connecté'),
      itemRow('Boîte Hotmail',microsoft.connected?
        ('Compte autorisé : '+(microsoft.label||'Outlook')):
        microsoft.configured?'Prête à être connectée':'Identifiants Microsoft à configurer dans Cloudflare',
        microsoft.connected?'Connectée':'Non connectée')
    );
    $('connectGoogle').hidden=!google.configured;
    $('disconnectGoogle').hidden=!google.connected||google.legacy;
    $('connectOutlook').hidden=!microsoft.configured;
    $('disconnectOutlook').hidden=!microsoft.connected;
  }catch(error){
    root.textContent='État des connexions indisponible : '+error.message;
  }
}
async function disconnectService(provider){
  const name=provider==='google'?'Google Agenda':'Hotmail';
  if(!window.confirm('Déconnecter '+name+' ? Les événements Google et les messages existants ne seront pas supprimés.'))return;
  try{
    const outcome=await jsonCall('/api/admin/integrations','POST',{action:'disconnect',provider,confirm:true});
    notify(outcome.legacy_remains
      ?'La connexion OAuth a été retirée, mais GOOGLE_REFRESH_TOKEN est encore actif dans Cloudflare.'
      :name+' déconnecté de Klosques Manager.');
    await loadExternalConnections();
    if(provider==='google')await loadGoogleCalendar();
    if(provider==='microsoft'){
      $('outlookMailList').replaceChildren();
      $('outlookMailStatus').textContent='Compte déconnecté. Reconnecte-le depuis Site.';
    }
  }catch(error){notify(error.message);}
}
$('refreshConnections').addEventListener('click',loadExternalConnections);
$('disconnectGoogle').addEventListener('click',()=>disconnectService('google'));
$('disconnectOutlook').addEventListener('click',()=>disconnectService('microsoft'));
document.querySelector('[data-tab="site"]').addEventListener('click',loadExternalConnections);

function renderGoogleCalendar(items,links){
  const root=$('googleCalendarEvents');root.replaceChildren();
  if(!items.length){root.append(itemRow('Aucun événement Google sur ce mois','Le calendrier Google ne contient aucun événement dans la période sélectionnée.'));return;}
  for(const event of items.slice(0,80)){
    const matches=state.items.filter(b=>b.event_date===event.date&&['option','confirme'].includes(b.status));
    const extra=matches.length&&!event.own_event
      ?' · Date également utilisée dans le Manager : à vérifier':'';
    root.append(itemRow(event.date+' — '+event.title,
      (event.location?event.location+' · ':'')+
      (event.availability==='free'?'Disponible':'Occupé')+extra,
      event.own_event?'Créé par Manager':null));
  }
}
function renderGooglePublishing(links){
  const panel=$('googlePublishPanel');panel.hidden=state.role!=='admin';
  if(panel.hidden)return;
  const root=$('googlePublishItems');root.replaceChildren();
  const map=new Map(links.map(link=>[link.booking_id,link]));
  const candidates=state.items.filter(item=>
    item.status==='confirme'||map.has(item.id)
  ).sort((a,b)=>a.event_date.localeCompare(b.event_date)).slice(0,50);
  if(!candidates.length){root.append(itemRow('Aucun concert confirmé','Confirme un concert dans le Manager pour pouvoir l’ajouter à Google.'));return;}
  for(const b of candidates){
    const linked=map.has(b.id);
    const row=itemRow((b.event_date||'Date')+' — '+(b.location||'Lieu'),
      linked?'Ce concert est associé à Google Agenda.':'Concert confirmé non encore ajouté dans Google.',
      linked?'Synchronisé':'Non publié');
    const actions=document.createElement('div');actions.className='integration-actions';
    if(b.status==='confirme'){
      const publish=document.createElement('button');
      publish.type='button';publish.className='secondary';
      publish.textContent=linked?'Mettre à jour sur Google':'Ajouter à Google';
      publish.dataset.googleAction='publish';publish.dataset.bookingId=b.id;
      actions.appendChild(publish);
    }
    if(linked){
      const remove=document.createElement('button');
      remove.type='button';remove.className='secondary';
      remove.textContent='Retirer de Google';
      remove.dataset.googleAction='remove';remove.dataset.bookingId=b.id;
      actions.appendChild(remove);
    }
    row.appendChild(actions);root.appendChild(row);
  }
  // Rendre aussi accessibles les anciens événements dont la fiche Manager a
  // été effacée, afin de pouvoir les retirer de Google après confirmation.
  for(const link of links.filter(l=>!state.items.some(b=>b.id===l.booking_id)).slice(0,20)){
    const row=itemRow('Ancien concert de Klosques Manager',
      'La fiche n’existe plus dans Manager, mais l’événement reste sur Google.','Synchronisé');
    const remove=document.createElement('button');
    remove.type='button';remove.className='secondary';
    remove.textContent='Retirer de Google';
    remove.dataset.googleAction='remove';remove.dataset.bookingId=link.booking_id;
    row.appendChild(remove);root.appendChild(row);
  }
}
async function loadGoogleCalendar(){
  if(!state.logged)return;
  const status=$('googleCalendarStatus'),root=$('googleCalendarEvents');
  const month=$('agendaMonth').value;
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;
  status.textContent='Lecture de Google Agenda…';
  $('refreshGoogleCalendar').disabled=true;
  try{
    const data=await callApi('/api/admin/google-calendar?month='+encodeURIComponent(month));
    if(!data.connected){
      status.textContent='Google Agenda non connecté : le responsable peut le relier dans Site → Connexions.';
      root.replaceChildren();
      $('googlePublishPanel').hidden=true;
      return;
    }
    status.textContent='Google Agenda synchronisé pour '+month+
      (data.truncated?' · liste partielle, de nombreux événements existent':'')+
      ' · seuls les événements ajoutés depuis Manager peuvent être modifiés ici.';
    renderGoogleCalendar(data.events||[],data.links||[]);
    renderGooglePublishing(data.links||[]);
  }catch(error){
    status.textContent='Lecture Google indisponible : '+error.message;
    root.replaceChildren();$('googlePublishPanel').hidden=true;
  }finally{$('refreshGoogleCalendar').disabled=false;}
}
$('refreshGoogleCalendar').addEventListener('click',loadGoogleCalendar);
$('agendaMonth').addEventListener('change',loadGoogleCalendar);
document.querySelector('[data-tab="agenda"]').addEventListener('click',loadGoogleCalendar);
$('googlePublishItems').addEventListener('click',async event=>{
  const target=event.target.closest('[data-google-action]');
  if(!target||state.role!=='admin')return;
  const booking=state.items.find(x=>x.id===target.dataset.bookingId);
  const action=target.dataset.googleAction;
  if(action==='publish'&&!booking)return;
  const confirmation=action==='remove'?
    'Retirer de Google Agenda cet événement créé par Manager ? Le concert restera dans Klosques Manager.':
    'Synchroniser ce concert confirmé dans Google Agenda ? Il sera ajouté ou mis à jour en événement privé sur une journée entière.';
  if(!window.confirm(confirmation))return;
  target.disabled=true;
  try{
    await jsonCall('/api/admin/google-calendar/sync','POST',{
      action,booking_id:target.dataset.bookingId,confirm:true
    });
    notify(action==='remove'?'Concert retiré de Google Agenda.':'Concert synchronisé avec Google Agenda.');
    await loadGoogleCalendar();
  }catch(error){notify(error.message);}
  finally{target.disabled=false;}
});

async function loadOutlookMailbox(){
  if(!state.logged||state.role!=='admin')return;
  const status=$('outlookMailStatus'),root=$('outlookMailList');
  status.textContent='Lecture des messages Hotmail…';
  $('refreshOutlookMail').disabled=true;
  try{
    const data=await callApi('/api/admin/outlook-mail');
    root.replaceChildren();
    if(!data.connected){
      status.textContent='Boîte Hotmail non connectée. Va dans Site → Connexions.';
      return;
    }
    status.textContent='Boîte '+(data.account||'Hotmail')+
      ' · lecture seule · '+(data.messages||[]).length+' message(s) récents.';
    if(!data.messages?.length){
      root.append(itemRow('Boîte de réception vide','Aucun message récent.'));return;
    }
    for(const mail of data.messages){
      const row=itemRow((mail.unread?'● ':'')+mail.subject,
        (mail.from_name||mail.from_address)+' · '+
        (mail.received_at||'')+
        (mail.preview?' · '+mail.preview:''),
        mail.unread?'Non lu':null);
      if(mail.web_url){
        const a=document.createElement('a');
        a.className='secondary link';a.target='_blank';a.rel='noopener noreferrer';
        a.href=mail.web_url;a.textContent='Ouvrir dans Outlook';
        row.appendChild(a);
      }
      root.appendChild(row);
    }
  }catch(error){
    status.textContent='Boîte mail indisponible : '+error.message;
    root.replaceChildren();
  }finally{$('refreshOutlookMail').disabled=false;}
}
$('refreshOutlookMail').addEventListener('click',loadOutlookMailbox);
document.querySelector('[data-tab="messagerie"]').addEventListener('click',loadOutlookMailbox);
function handleConnectionReturn(){
  const url=new URL(window.location.href);
  const status=url.searchParams.get('connexion')||'';
  if(!/^(google|microsoft)-(ok|erreur|expire|refuse|configuration|mauvais-compte)$/.test(status))return;
  url.searchParams.delete('connexion');
  window.history.replaceState(null,'',url.pathname+url.search+url.hash);
  setPage('site');
  const provider=status.startsWith('google')?'Google Agenda':'Boîte Hotmail';
  notify(status.endsWith('-ok')?provider+' connecté avec succès.':
    status.endsWith('mauvais-compte')?'Compte Microsoft incorrect : autorise uniquement LesKlosques@hotmail.com.':
    'Connexion '+provider+' non terminée. Vérifie le compte, les autorisations et la configuration.');
}
