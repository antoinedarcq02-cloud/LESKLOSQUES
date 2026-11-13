'use strict';

const $ = id => document.getElementById(id);
const STATUSES = {
  nouveau:'Nouvelle demande',en_discussion:'En discussion',devis_envoye:'Devis envoyé',
  option:'En option',confirme:'Confirmé',termine:'Terminé',refuse:'Refusé'
};
const quoteKeys = ['name','email','phone','event_type','event_date','location','package','message','notes','status'];
const state = { items:[], current:null, selectedDay:null, page:'home', logged:false };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => (
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]
));
function notify(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}
function dateLabel(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '';
  return new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
}
async function callApi(path, options = {}) {
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Une erreur est survenue.');
  return body;
}
function jsonCall(path, method, data) {
  return callApi(path, {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}
function showScreen(name) {
  for (const id of ['login','setup','passwordGate','welcome','workspace']) $(id).hidden = id !== name;
  state.logged = name === 'workspace' || name === 'passwordGate';
  $('account').hidden = !state.logged;
}
async function welcomeMusician(displayName) {
  const firstName = String(displayName || 'musicien').trim().split(/\s+/)[0].slice(0,30);
  $('welcomeFirstName').textContent = firstName + ' !';
  // Pour Antoine, afficher exactement l'illustration validée, sans redessiner sa bulle.
  $('welcomeBalloon').hidden = firstName.toLocaleLowerCase('fr-FR') === 'antoine';
  $('welcomeAnnounce').textContent = 'Bienvenue ' + firstName + ' ! Accès à Klosques Manager…';
  showScreen('welcome');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  await new Promise(resolve => window.setTimeout(resolve, reduceMotion ? 350 : 1650));
}
async function signedIn(account, showWelcome = false) {
  state.role = account.role;
  state.mustChangePassword = !!account.must_change_password;
  $('identity').textContent = account.display_name || account.username;
  $('membersPanel').hidden = account.role !== 'admin';
  $('cancelPasswordChange').hidden = state.mustChangePassword;
  $('passwordExplanation').textContent = state.mustChangePassword
    ? 'Ceci est ton mot de passe provisoire : choisis-en un nouveau, personnel, avant de consulter les dossiers.'
    : 'Choisis un nouveau mot de passe personnel d’au moins 15 caractères.';
  if (state.mustChangePassword) {
    showScreen('passwordGate');
    return;
  }
  if (showWelcome) await welcomeMusician(account.display_name || account.username);
  showScreen('workspace');
  await refresh();
  await loadSiteContent();
  if (state.role === 'admin') await loadMembers();
}
async function initialize() {
  $('agendaMonth').value = new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0');
  try {
    const session = await callApi('/api/admin/auth');
    if (session.authenticated) await signedIn(session);
    else showScreen(session.needsSetup ? 'setup' : 'login');
  } catch (error) { showScreen('login'); notify(error.message); }
}
$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('loginBtn');
  button.disabled = true;
  notify('');
  try {
    const account = await jsonCall('/api/admin/auth','POST',{
      action:'login',
      username:$('loginUsername').value,
      password:$('loginPassword').value
    });
    $('loginPassword').value = '';
    await signedIn(account, true);
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; }
});
$('setupForm').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('setupPassword').value !== $('setupConfirm').value) {
    notify('Les mots de passe ne correspondent pas.'); return;
  }
  const button = $('setupSubmit');
  button.disabled = true;
  notify('');
  try {
    const account = await jsonCall('/api/admin/auth','POST',{
      action:'bootstrap',
      setup_key:$('setupKey').value,
      username:$('setupUsername').value,
      display_name:$('setupDisplay').value,
      password:$('setupPassword').value
    });
    $('setupKey').value = '';
    $('setupPassword').value = '';
    $('setupConfirm').value = '';
    await signedIn(account, true);
    notify('Premier compte créé. Tu peux maintenant ajouter les trois autres musiciens dans la rubrique Site.');
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; }
});
$('logoutBtn').addEventListener('click', async () => {
  try { await jsonCall('/api/admin/auth','POST',{action:'logout'}); }
  catch (error) { notify(error.message); return; }
  state.items = [];
  state.role = null;
  state.mustChangePassword = false;
  $('loginPassword').value = '';
  $('passwordForm').reset();
  showScreen('login');
  notify('Tu es déconnecté.');
});
$('changeMyPassword').addEventListener('click', () => {
  $('passwordForm').reset();
  $('cancelPasswordChange').hidden = false;
  $('passwordExplanation').textContent = 'Choisis un nouveau mot de passe personnel d’au moins 15 caractères.';
  showScreen('passwordGate');
});
$('cancelPasswordChange').addEventListener('click', () => {
  if (state.mustChangePassword) return;
  $('passwordForm').reset();
  showScreen('workspace');
});
$('passwordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = $('passwordForm');
  const current_password = form.elements.namedItem('current_password').value;
  const new_password = form.elements.namedItem('new_password').value;
  const confirm = form.elements.namedItem('confirm').value;
  if (new_password !== confirm) { notify('Les nouveaux mots de passe ne correspondent pas.'); return; }
  const btn = $('changePasswordSubmit');
  btn.disabled = true;
  notify('');
  try {
    await jsonCall('/api/admin/password','POST',{current_password,new_password});
    form.reset();
    state.mustChangePassword = false;
    await welcomeMusician($('identity').textContent);
    showScreen('workspace');
    await refresh();
    await loadSiteContent();
    if (state.role === 'admin') await loadMembers();
    notify('Ton mot de passe a été modifié. Tes anciennes sessions sont désormais invalides.');
  } catch(error) { notify(error.message); }
  finally { btn.disabled = false; }
});
function setPage(page) {
  state.page = page;
  document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== 'panel-'+page);
  document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === page));
  $('pageTitle').textContent = {
    home:'Tableau de bord',agenda:'Agenda',demandes:'Demandes clients',
    concerts:'Fiches concerts',devis:'Devis',site:'Gestion du site'
  }[page] || 'Klosques Manager';
  render();
}
document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click',() => setPage(el.dataset.tab)));
async function refresh() {
  try {
    const data = await callApi('/api/admin/bookings');
    state.items = data.bookings || [];
    notify('');
    render();
  } catch (error) {
    notify(error.message);
  }
}
function itemCard(item) {
  const category = item.status === 'confirme' ? 'confirmed' :
    item.status === 'refuse' ? 'declined' : ['nouveau','option'].includes(item.status) ? 'pending' : '';
  return '<button type="button" class="booking-card" data-open="'+escapeHtml(item.id)+'">' +
    '<div class="card-top"><span class="date">'+escapeHtml(dateLabel(item.event_date))+'</span>' +
    '<span class="tag '+category+'">'+escapeHtml(STATUSES[item.status] || item.status)+'</span></div>' +
    '<h3>'+escapeHtml(item.name)+'</h3>' +
    '<p>📍 '+escapeHtml(item.location)+'</p>' +
    (item.package ? '<p>🎸 '+escapeHtml(item.package)+'</p>' : '') +
    (item.quote_amount_cents != null ? '<p>💶 '+escapeHtml((item.quote_amount_cents/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'}))+'</p>' : '') +
    '<p class="small">Ouvrir la fiche →</p></button>';
}
function fillList(id, items, empty = 'Aucun dossier à afficher.') {
  $(id).innerHTML = items.length ? items.map(itemCard).join('') : '<p class="empty">'+escapeHtml(empty)+'</p>';
}
function render() {
  if (!state.logged) return;
  const items = state.items;
  $('statRequests').textContent = items.filter(x => ['nouveau','en_discussion'].includes(x.status)).length;
  $('statConcerts').textContent = items.filter(x => x.status === 'confirme').length;
  $('statQuotes').textContent = items.filter(x => x.status === 'devis_envoye').length;
  $('statOptions').textContent = items.filter(x => x.status === 'option').length;
  fillList('homeList',items.filter(x => !['termine','refuse'].includes(x.status)).slice(0,8),'Aucune demande en cours.');
  let requests = items.filter(x => x.source === 'site');
  if ($('requestFilter').value !== 'all') requests = requests.filter(x => x.status === $('requestFilter').value);
  fillList('requestsList', requests, 'Aucune demande reçue depuis le formulaire.');
  let concerts = items.filter(x => ['option','confirme','termine'].includes(x.status));
  if ($('concertFilter').value !== 'all') concerts = concerts.filter(x => x.status === $('concertFilter').value);
  fillList('concertsList',concerts,'Aucun concert enregistré.');
  // La liste des devis numérotés est maintenant gérée par quote-builder.js.
  renderCalendar();
}
['requestFilter','concertFilter','agendaMonth'].forEach(id => $(id).addEventListener('change',() => { if(id==='agendaMonth') state.selectedDay=null; render(); }));
function renderCalendar() {
  const month = $('agendaMonth').value;
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const [year, mon] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year,mon-1,1)).getUTCDay()+6)%7;
  const days = new Date(Date.UTC(year,mon,0)).getUTCDate();
  const today = new Date().toLocaleDateString('en-CA');
  let html = '<div class="cal-grid">';
  for (const weekday of ['L','M','M','J','V','S','D']) html += '<span class="weekday">'+weekday+'</span>';
  for (let i=0;i<offset;i++) html += '<div></div>';
  for (let day=1;day<=days;day++) {
    const date = month+'-'+String(day).padStart(2,'0');
    const events = state.items.filter(x => x.event_date === date && ['option','confirme'].includes(x.status));
    const classes = 'day'+(today===date?' today':'')+(events.length?' has-bookings':'');
    const dots = events.slice(0,4).map(x => '<span class="dot '+(x.status==='confirme'?'confirmed':'pending')+'"></span>').join('');
    html += '<button class="'+classes+'" data-day="'+date+'" type="button" title="'+escapeHtml(String(events.length)+' événement(s)')+'"><span>'+day+'</span><span class="dots">'+dots+'</span></button>';
  }
  $('calendar').innerHTML = html+'</div>';
  const monthItems = state.items.filter(x => x.event_date.startsWith(month) && ['option','confirme','termine'].includes(x.status))
    .filter(x => !state.selectedDay || x.event_date === state.selectedDay)
    .sort((a,b) => a.event_date.localeCompare(b.event_date));
  fillList('agendaList', monthItems, 'Aucun concert sur cette période.');
}
document.addEventListener('click', event => {
  const card = event.target.closest('[data-open]');
  if (card) openEditor(state.items.find(item => item.id === card.dataset.open));
  const day = event.target.closest('[data-day]');
  if (day) { state.selectedDay = state.selectedDay === day.dataset.day ? null : day.dataset.day; renderCalendar(); }
});
const bookingDialog = $('bookingDialog'), editor = $('bookingEditor');
$('newBooking').addEventListener('click',() => openEditor(null));
$('closeDialog').addEventListener('click',() => bookingDialog.close());
function openEditor(item) {
  state.current = item || null;
  editor.reset();
  $('dialogTitle').textContent = item ? 'Fiche concert / demande' : 'Ajouter un concert';
  for (const key of quoteKeys) {
    const el = editor.elements.namedItem(key);
    if (el) el.value = item ? String(item[key] ?? '') : (key==='status' ? 'option' : '');
  }
  const price = editor.elements.namedItem('quote_euros');
  price.value = item && item.quote_amount_cents != null ? String(item.quote_amount_cents/100) : '';
  $('editorMeta').textContent = item ? 'Créé le '+(item.created_at || '')+' · Dernière modification : '+(item.updated_by || 'non renseignée') : 'Fiche ajoutée manuellement. Aucun email envoyé automatiquement.';
  $('printDraft').disabled = !item;
  // La suppression n'est proposée que pour les demandes issues du site.
  $('deleteRequest').hidden = !item || item.source !== 'site';
  bookingDialog.showModal();
}
const deleteRequestDialog = $('deleteRequestDialog');
$('deleteRequest').addEventListener('click', () => {
  const item = state.current;
  if (!item || item.source !== 'site') return;
  $('deleteRequestDetails').textContent =
    'Client : ' + item.name + ' · Date : ' + dateLabel(item.event_date) +
    ' · Lieu : ' + (item.location || 'non précisé');
  deleteRequestDialog.showModal();
});
$('cancelDelete').addEventListener('click', () => deleteRequestDialog.close());
$('confirmDelete').addEventListener('click', async () => {
  const item = state.current;
  if (!item || item.source !== 'site') return;
  const button = $('confirmDelete');
  button.disabled = true;
  notify('');
  try {
    await callApi('/api/admin/bookings/' + encodeURIComponent(item.id), { method: 'DELETE' });
    deleteRequestDialog.close();
    bookingDialog.close();
    state.current = null;
    await refresh();
    notify('La demande a été supprimée définitivement.');
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
});
editor.addEventListener('submit', async event => {
  event.preventDefault();
  notify('');
  const button = $('saveBooking');
  button.disabled = true;
  const data = Object.fromEntries(quoteKeys.map(key => [key, editor.elements.namedItem(key).value]));
  const euros = editor.elements.namedItem('quote_euros').value;
  const cents = euros === '' ? null : Math.round(Number(euros) * 100);
  if (cents !== null && (!Number.isSafeInteger(cents) || cents<0 || cents>100000000)) {
    notify('Montant invalide.'); button.disabled = false; return;
  }
  try {
    if (state.current) {
      await jsonCall('/api/admin/bookings/'+encodeURIComponent(state.current.id),'PATCH',{...data,quote_amount_cents:cents});
    } else {
      const created = await jsonCall('/api/admin/bookings','POST',data);
      if (cents !== null) await jsonCall('/api/admin/bookings/'+encodeURIComponent(created.booking.id),'PATCH',{quote_amount_cents:cents});
    }
    bookingDialog.close();
    await refresh();
  } catch(error) { notify(error.message); }
  finally { button.disabled = false; }
});
$('printDraft').addEventListener('click',() => {
  if (!state.current) return;
  const form = Object.fromEntries(quoteKeys.map(key => [key, editor.elements.namedItem(key).value]));
  const amount = editor.elements.namedItem('quote_euros').value;
  const safe = escapeHtml;
  const rows = [
    ['Événement',form.event_type],['Date',dateLabel(form.event_date)],['Lieu',form.location],
    ['Prestation',form.package],['Organisateur',form.name],
    ['Email',form.email],['Téléphone',form.phone],['Informations',form.message]
  ].map(([key,value])=>'<p><strong>'+safe(key)+' :</strong> '+safe(value || 'À préciser')+'</p>').join('');
  const doc = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Proposition — Les Klosques</title>' +
   '<style>body{font:16px Arial,sans-serif;color:#171717;margin:44px auto;max-width:760px;line-height:1.55}h1{color:#b92039}header{border-bottom:2px solid #c52b42;margin-bottom:28px}p{overflow-wrap:anywhere}.warning{padding:14px;border:1px solid #c52b42;background:#fff0f2}button{padding:12px} @media print{button{display:none}}</style></head><body>' +
   '<header><h1>LES KLOSQUES</h1><p>Proposition de prestation — '+safe(dateLabel(form.event_date))+'</p></header>' +
   '<p class="warning"><strong>BROUILLON INTERNE — NE PAS ENVOYER COMME DEVIS OFFICIEL.</strong> Les mentions légales, le numéro et les conditions restent à valider.</p>' +
   rows+'<h2>Montant indicatif</h2><p>'+safe(amount === '' ? 'À définir' : Number(amount).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})+' (régime HT/TTC à préciser)')+'</p>' +
   '<button onclick="window.print()">Imprimer / Enregistrer en PDF</button></body></html>';
  const windowPrint = window.open('','_blank');
  if (!windowPrint) { notify('Autorise les fenêtres contextuelles pour ouvrir le brouillon.'); return; }
  windowPrint.document.open(); windowPrint.document.write(doc); windowPrint.document.close();
  windowPrint.focus();
});

const siteForm = $('siteContentForm');
async function loadSiteContent() {
  try {
    const data = await callApi('/api/admin/content');
    for (const [key, value] of Object.entries(data.content || {})) {
      const input = siteForm.elements.namedItem(key);
      if (input) input.value = value;
    }
  } catch (error) {
    notify(error.message);
  }
}
function getYoutubeId(value) {
  const raw = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') {
      const id = url.pathname.split('/')[1];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (!['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(url.hostname)) return null;
    const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})/)?.[1];
    return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}
function getReelId(value) {
  const raw = String(value || '').trim();
  if (/^\d{8,25}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !['facebook.com','www.facebook.com','m.facebook.com'].includes(url.hostname)) return null;
    const id = url.pathname.match(/\/reel\/(\d{8,25})\/?/)?.[1];
    return id || null;
  } catch { return null; }
}
siteForm.addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(siteForm).entries());
  for (const key of ['video_1','video_2','video_3']) {
    data[key] = getYoutubeId(data[key]);
    if (!data[key]) { notify('Vérifie le lien YouTube : '+key); return; }
  }
  data.facebook_reel = getReelId(data.facebook_reel);
  if (!data.facebook_reel) { notify('Vérifie le lien du Reel Facebook.'); return; }
  const button = siteForm.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await jsonCall('/api/admin/content','PATCH',data);
    notify('Contenu enregistré. Actualise le site public pour voir les modifications.');
    await loadSiteContent();
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; }
});


async function loadMembers() {
  if (state.role !== 'admin') return;
  try {
    const data = await callApi('/api/admin/users');
    const users = data.users || [];
    $('memberList').innerHTML = users.map(user =>
      '<div class="member-row"><strong>'+escapeHtml(user.display_name)+'</strong>' +
      '<span class="muted small">@'+escapeHtml(user.username)+(user.role === 'admin'?' · gestionnaire':' · musicien')+
      (user.must_change_password ? ' · mot de passe provisoire' : '')+'</span></div>'
    ).join('') || '<p class="muted">Aucun compte enregistré.</p>';
    $('memberCreateForm').hidden = users.length >= 4;
    const otherUsers = users.filter(user => user.role === 'member');
    $('memberResetUsername').innerHTML = otherUsers.map(user =>
      '<option value="'+escapeHtml(user.username)+'">'+escapeHtml(user.display_name)+'</option>'
    ).join('');
    $('memberResetForm').hidden = otherUsers.length === 0;
  } catch (error) { notify(error.message); }
}
$('memberCreateForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  notify('');
  try {
    await jsonCall('/api/admin/users', 'POST', {
      ...Object.fromEntries(new FormData(form)),
      action:'create'
    });
    form.reset();
    await loadMembers();
    notify('Compte créé. Communique le mot de passe provisoire à ce musicien par un moyen privé.');
  } catch(error) { notify(error.message); }
  finally { form.elements.namedItem('admin_password').value=''; button.disabled = false; }
});
$('memberResetForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  notify('');
  try {
    await jsonCall('/api/admin/users', 'POST', {
      ...Object.fromEntries(new FormData(form)),
      action:'reset'
    });
    form.reset();
    await loadMembers();
    notify('Mot de passe réinitialisé. L’ancien accès est invalidé et le musicien devra changer le mot de passe provisoire.');
  } catch(error) { notify(error.message); }
  finally { form.elements.namedItem('admin_password').value=''; button.disabled = false; }
});

initialize();
