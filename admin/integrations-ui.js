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
    $('newGoogleEvent').disabled=!google.connected;
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
let googleCalendarRequestSerial=0;
async function loadGoogleCalendar(){
  if(!state.logged)return;
  const serial=++googleCalendarRequestSerial;
  const status=$('googleCalendarStatus');
  const month=$('agendaMonth').value;
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;
  status.textContent='Lecture des deux agendas partagés Google…';
  $('refreshGoogleCalendar').disabled=true;
  try{
    const data=await callApi('/api/admin/google-calendar?month='+encodeURIComponent(month));
    // Empêcher le retour d'une ancienne requête d'écraser un nouveau mois.
    if(serial!==googleCalendarRequestSerial||!state.logged||month!==$('agendaMonth').value)return;
    if(!data.connected){
      state.googleEvents=[];state.googleLinks=[];state.googleMonth=month;
      renderCalendar();
      status.textContent='Google Agenda non connecté : le responsable peut le relier dans Site → Connexions.';
      $('googlePublishPanel').hidden=true;
      return;
    }
    state.googleEvents=Array.isArray(data.events)?data.events:[];
    state.googleLinks=Array.isArray(data.links)?data.links:[];
    state.googleMonth=month;
    renderCalendar();
    status.textContent='Les deux agendas partagés sont intégrés au calendrier commun'+
      (data.truncated?' · Certains événements Google ne sont pas encore chargés.':'.');
    if(state.role==='admin')renderGooglePublishing(state.googleLinks);
  }catch(error){
    if(serial!==googleCalendarRequestSerial||!state.logged||month!==$('agendaMonth').value)return;
    state.googleEvents=[];state.googleLinks=[];state.googleMonth=month;
    renderCalendar();
    status.textContent='Lecture Google indisponible : '+error.message;
    $('googlePublishPanel').hidden=true;
  }finally{
    if(serial===googleCalendarRequestSerial)$('refreshGoogleCalendar').disabled=false;
  }
}
$('refreshGoogleCalendar').addEventListener('click',loadGoogleCalendar);
$('agendaMonth').addEventListener('change',loadGoogleCalendar);
document.querySelector('[data-tab="agenda"]').addEventListener('click',loadGoogleCalendar);
document.querySelector('[data-tab="site"]').addEventListener('click',()=>{
  if(state.logged&&state.role==='admin')loadGoogleCalendar();
});
$('googlePublishItems').addEventListener('click',async event=>{
  const target=event.target.closest('[data-google-action]');
  if(!target||state.role!=='admin')return;
  const booking=state.items.find(x=>x.id===target.dataset.bookingId);
  const action=target.dataset.googleAction;
  if(action==='publish'&&!booking)return;
  const confirmation=action==='remove'?
    'Retirer de Google Agenda cet événement créé par Manager ? Le concert restera dans Klosques Manager.':
    'Synchroniser ce concert confirmé dans KLOSQUES PARTAGE ? Il sera ajouté ou mis à jour en événement privé sur une journée entière.';
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

// Ajouter un événement directement dans un calendrier partagé, sans créer
// de fiche concert. Même UUID si une requête doit être retentée après une coupure.
const googleEventDialog=$('googleEventDialog');
const googleEventForm=$('googleEventForm');
let googleEventNonce=null;
const googleEventField=name=>googleEventForm.elements.namedItem(name);
function updateGoogleEventTimeFields(){
  const allDay=googleEventField('all_day').checked;
  $('googleEventTimes').hidden=allDay;
  for(const name of ['start_time','end_time']){
    const input=googleEventField(name);
    input.disabled=allDay;
    input.required=!allDay;
  }
}
$('newGoogleEvent').addEventListener('click',()=>{
  if(!state.logged||state.role!=='admin')return;
  googleEventForm.reset();
  googleEventNonce=crypto.randomUUID();
  const month=$('agendaMonth').value;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Paris'});
  const chosen=state.selectedDay||
    (today.startsWith(month)?today:month+'-01');
  googleEventField('start_date').value=chosen;
  googleEventField('end_date').value=chosen;
  $('googleEventFeedback').textContent='';
  updateGoogleEventTimeFields();
  googleEventDialog.showModal();
});
googleEventField('all_day').addEventListener('change',updateGoogleEventTimeFields);
googleEventField('start_date').addEventListener('change',()=>{
  const first=googleEventField('start_date').value;
  const last=googleEventField('end_date');
  if(first&&(!last.value||last.value<first))last.value=first;
});
function closeGoogleEventDialog(){
  if(!$('saveGoogleEvent').disabled)googleEventDialog.close();
}
$('closeGoogleEvent').addEventListener('click',closeGoogleEventDialog);
googleEventDialog.addEventListener('cancel',event=>{
  if($('saveGoogleEvent').disabled)event.preventDefault();
});
$('cancelGoogleEvent').addEventListener('click',closeGoogleEventDialog);
googleEventForm.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!state.logged||state.role!=='admin'||!googleEventNonce)return;
  const start=googleEventField('start_date').value;
  const end=googleEventField('end_date').value;
  const allDay=googleEventField('all_day').checked;
  const startTime=googleEventField('start_time').value;
  const endTime=googleEventField('end_time').value;
  const feedback=$('googleEventFeedback');
  if(end<start||(!allDay&&(start+'T'+startTime>=end+'T'+endTime))){
    feedback.textContent='Vérifie les dates et les heures : la fin doit suivre le début.';
    return;
  }
  const payload={
    calendar:googleEventField('calendar').value,
    title:googleEventField('title').value.trim(),
    start_date:start,end_date:end,all_day:allDay,
    start_time:allDay?'':startTime,end_time:allDay?'':endTime,
    location:googleEventField('location').value.trim(),
    description:googleEventField('description').value.trim(),
    request_id:googleEventNonce,
    confirm:true
  };
  const calendarName=payload.calendar==='concerts'
    ?'KLOSQUES PARTAGE':'KLOSQUES PAS DISPO PARTAGE';
  const period=payload.start_date===payload.end_date
    ?dateLabel(payload.start_date)
    :dateLabel(payload.start_date)+' au '+dateLabel(payload.end_date);
  const times=allDay?' (toute la journée)':' de '+startTime+' à '+endTime;
  if(!window.confirm('Créer « '+payload.title+' » dans '+calendarName+
    ' le '+period+times+' ?'+String.fromCharCode(10,10)+'L’événement sera réellement enregistré dans Google Agenda.'))return;
  const save=$('saveGoogleEvent');
  save.disabled=true;
  feedback.textContent='Création de l’événement sur Google Agenda…';
  try{
    await jsonCall('/api/admin/google-calendar/create','POST',payload);
    // Après un succès réseau (ou une confirmation idempotente), nouveau nonce.
    googleEventNonce=null;
    googleEventDialog.close();
    $('agendaMonth').value=start.slice(0,7);
    state.selectedDay=start;
    renderCalendar();
    await loadGoogleCalendar();
    notify('Événement enregistré dans '+calendarName+'.');
  }catch(error){
    feedback.textContent=error.message+
      ' Si la connexion a été coupée, réessaie sans fermer ce formulaire pour éviter un doublon.';
  }finally{
    save.disabled=false;
  }
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
