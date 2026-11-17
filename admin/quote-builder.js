'use strict';

// Éditeur privé de devis. Tous les documents sont conservés dans D1,
// chaque devis finalisé devient non modifiable.
const officialQuoteState = {quotes:[],issuer:{},current:null,mailReady:false};
const officialQuoteFields = [
  'issuer_name','issuer_address','issuer_identifier','issuer_contact','issuer_legal',
  'client_name','client_address','client_email','event_date','event_time','event_location',
  'issue_date','valid_until','description','conditions'
];
const officialIssuerFields = ['issuer_name','issuer_address','issuer_identifier','issuer_contact','issuer_legal'];
const directQuotePricing = () => !officialQuoteState.current ||
  officialQuoteState.current.data?.vat_mode === 'ttc_sans_ventilation';
const officialQuoteForm = $('officialQuoteForm');
const officialMoney = cents => (cents / 100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
// Un devis n'est indiqué « envoyé » qu'après un envoi d'e-mail journalisé.
// La finalisation seule n'est jamais une preuve d'envoi.
function quoteEmailStatus(quote) {
  return quote?.sent_at
    ? {label:'Devis envoyé',className:'confirmed'}
    : {label:'En attente d’envoi',className:'pending'};
}
const officialToday = (date = new Date()) => [
  date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')
].join('-');
function quoteLine(label = '',qty = 1,priceCents = 0) {
  if ($('quoteLines').children.length >= 12) {
    notify('Un devis peut comporter jusqu’à 12 lignes de prestation.');
    return;
  }
  const row = document.createElement('div');
  row.className = 'official-quote-line';
  const desc = document.createElement('input');
  desc.type = 'text'; desc.maxLength = 220; desc.placeholder = 'Description de la prestation';
  desc.setAttribute('aria-label','Prestation');
  desc.className = 'quote-line-label'; desc.value = label;
  desc.setAttribute('list','klosquesServiceSuggestions');
  const quantity = document.createElement('input');
  quantity.type = 'number'; quantity.min = '0.01'; quantity.max = '1000'; quantity.step = '0.01';
  quantity.setAttribute('aria-label','Quantité'); quantity.className = 'quote-line-qty'; quantity.value = String(qty);
  const price = document.createElement('input');
  price.type = 'number'; price.min = '0'; price.max = '1000000'; price.step = '0.01';
  price.setAttribute('aria-label',directQuotePricing()?'Prix TTC en euros':'Prix HT en euros'); price.className = 'quote-line-price'; price.value = priceCents ? (priceCents/100).toFixed(2) : '';
  const remove = document.createElement('button');
  remove.type = 'button'; remove.className = 'small-button quote-line-remove';
  remove.setAttribute('aria-label','Retirer cette ligne'); remove.textContent = '✕';
  remove.addEventListener('click',() => { row.remove(); updateOfficialTotals(); });
  for (const el of [desc,quantity,price]) el.addEventListener('input',updateOfficialTotals);
  row.append(desc,quantity,price,remove);
  $('quoteLines').append(row);
  updateOfficialTotals();
}
function collectOfficialQuote() {
  const data = {};
  for (const key of officialQuoteFields) data[key] = officialQuoteForm.elements.namedItem(key).value.trim();
  // Les anciens devis conservent leur régime historique, y compris en brouillon.
  // Les nouveaux devis n'imposent aucun régime fiscal : prix saisis TTC.
  data.vat_mode = officialQuoteState.current?.data?.vat_mode || 'ttc_sans_ventilation';
  data.issuer_tax_number = officialQuoteState.current?.data?.issuer_tax_number || '';
  // Preserver les devis historiques, mais les nouveaux n'imposent aucun mode
  // de paiement et les anciens devis finalises restent intacts.
  data.payment_terms = officialQuoteState.current?.data?.payment_terms || '';
  data.lines = Array.from($('quoteLines').children).map(row => {
    const label = row.querySelector('.quote-line-label').value.trim();
    const qty = Number(row.querySelector('.quote-line-qty').value);
    const rawPrice = row.querySelector('.quote-line-price').value;
    const price = rawPrice === '' ? 0 : Number(rawPrice);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1000 ||
        !Number.isFinite(price) || price < 0 || price > 1000000)
      throw new Error('Vérifie les quantités et les montants des prestations.');
    return { label, qty, price_cents:Math.round(price * 100) };
  }).filter(line => line.label || line.price_cents);
  return data;
}
function officialTotals(data) {
  const ht = data.lines.reduce((total,line) => total + Math.round(line.qty * line.price_cents),0);
  const direct = data.vat_mode === 'ttc_sans_ventilation';
  const pending = data.vat_mode === 'non_precise';
  const percent = direct || pending || data.vat_mode === 'franchise' ? 0 : Number(data.vat_mode);
  const vat = Math.round(ht * percent / 100);
  return {ht,vat,ttc:ht+vat,pending,direct};
}
function updateOfficialTotals() {
  try {
    const data = collectOfficialQuote();
    const t = officialTotals(data);
    $('quoteTotals').textContent = t.direct
      ? 'Total TTC : ' + officialMoney(t.ttc)
      : t.pending ? 'Total HT : ' + officialMoney(t.ht) + ' · TVA et TTC : à préciser'
      : 'Total HT : ' + officialMoney(t.ht) + ' · TVA : ' + officialMoney(t.vat) +
        ' · Total TTC : ' + officialMoney(t.ttc);
  } catch { $('quoteTotals').textContent = 'Vérifie les prix et les quantités.'; }
}
function populateBookingSelect() {
  const picker = $('quoteBooking');
  const old = picker.value;
  picker.replaceChildren(new Option('Devis indépendant / sans demande',''));
  for (const item of state.items) {
    picker.add(new Option(item.name + ' — ' + dateLabel(item.event_date),item.id));
  }
  picker.value = old;
}
function updateQuoteLock() {
  const quote = officialQuoteState.current;
  const locked = quote?.status === 'finalise';
  const statusBadge = $('quoteEmailStatus');
  const emailStatus = quoteEmailStatus(quote);
  statusBadge.hidden = !quote;
  statusBadge.className = 'tag ' + emailStatus.className;
  statusBadge.textContent = emailStatus.label;
  for (const control of officialQuoteForm.querySelectorAll('input,textarea,select,button')) {
    control.disabled = locked;
  }
  $('quoteLocked').hidden = !locked;
  $('printOfficialQuote').disabled = !officialQuoteState.current;
  $('downloadOfficialQuote').hidden = !officialQuoteState.current ||
    officialQuoteState.current.status !== 'finalise';
  $('downloadOfficialQuote').disabled = !officialQuoteState.current ||
    officialQuoteState.current.status !== 'finalise';
  $('finalizeOfficialQuote').hidden = locked;
  $('saveOfficialQuote').hidden = locked;
  $('sendOfficialQuote').hidden = !locked;
  const sent = officialQuoteState.current?.sent_at;
  $('quoteSendHistory').hidden = !sent;
  $('quoteSendHistory').textContent = sent
    ? 'Dernier envoi enregistré : ' + sent + ' · ' + (officialQuoteState.current.sent_to || '')
    : '';
}
function fillQuoteForm(record = null) {
  officialQuoteState.current = record;
  officialQuoteForm.reset();
  $('quoteLines').replaceChildren();
  populateBookingSelect();
  const data = record?.data || {};
  for (const field of officialQuoteFields) {
    const input = officialQuoteForm.elements.namedItem(field);
    if (input) input.value = data[field] || '';
  }
  if (!record) {
    for (const key of officialIssuerFields) {
      officialQuoteForm.elements.namedItem(key).value =
        officialQuoteState.issuer[key] || HAPPY_LIVE_ISSUER_DEFAULTS[key] || '';
    }
    const now = new Date();
    officialQuoteForm.elements.namedItem('issue_date').value = officialToday(now);
    const valid = new Date(now.getFullYear(),now.getMonth(),now.getDate()+30);
    officialQuoteForm.elements.namedItem('valid_until').value = officialToday(valid);
  }
  const linked = record?.booking_id || '';
  if (linked && !Array.from($('quoteBooking').options).some(option => option.value === linked))
    $('quoteBooking').add(new Option('Demande archivée',linked));
  $('quoteBooking').value = linked;
  const direct = directQuotePricing();
  $('quotePriceTypeText').textContent = direct ? 'Prix unitaire TTC' : 'Prix unitaire HT';
  $('quotePricingInfo').textContent = direct
    ? 'Saisis la description à imprimer, la quantité et le prix unitaire TTC en euros.'
    : 'Ancien devis : les prix sont indiqués HT. Le calcul fiscal d’origine reste conservé.';
  const lines = data.lines?.length ? data.lines :
    [{label:record?'':'Prestation Groupe Les Klosques',qty:1,price_cents:0}];
  for (const line of lines) quoteLine(line.label,line.qty,line.price_cents);
  $('quoteFormTitle').textContent = record ? 'Devis '+record.number : 'Nouveau devis';
  $('quoteNumber').textContent = record
    ? record.number+' · '+(record.status === 'finalise' ? 'Finalisé' : 'Brouillon')
    : 'Un numéro de devis sera attribué lors du premier enregistrement.';
  $('quoteFormPanel').hidden = false;
  $('quoteIssuerDetails').open=Boolean(record&&
    officialIssuerFields.some(key=>!data[key]));
  $('quoteAdditionalDetails').open=Boolean(record&&
    (data.description||data.conditions||data.event_time));
  $('deleteOfficialQuote').hidden = !record;
  updateOfficialTotals();
  updateQuoteLock();
  captureDocumentBaseline('devis');
  $('quoteFormPanel').scrollIntoView({block:'start',behavior:'smooth'});
}
function fillFromBooking() {
  const booking = state.items.find(item => item.id === $('quoteBooking').value);
  if (!booking) return;
  const fields = {
    client_name:booking.name,client_email:booking.email,
    event_date:booking.event_date,event_location:booking.location,
    description:booking.message
  };
  for (const [key,value] of Object.entries(fields))
    if (value) officialQuoteForm.elements.namedItem(key).value = value;
  // Les prestations et leurs tarifs restent libres : ne pas recopier
  // la formule choisie sur le site dans les lignes du devis.
  updateOfficialTotals();
}
function renderOfficialQuotes() {
  $('officialQuotesList').innerHTML = officialQuoteState.quotes.length
    ? officialQuoteState.quotes.map(quote => {
        const safe = escapeHtml;
        const delivery = quoteEmailStatus(quote);
        const finalized = quote.status === 'finalise';
        return '<article class="document-list-item" data-document-quote="'+quote.id+'">' +
          '<button type="button" class="booking-card" data-quote-id="'+quote.id+'">' +
          '<div class="card-top"><span class="date">'+safe(quote.number)+'</span>' +
          '<span class="tag '+delivery.className+'">'+safe(delivery.label)+'</span></div>' +
          (!finalized ? '<p class="small">Brouillon à finaliser avant l’envoi</p>' : '') +
          '<h3>'+safe(quote.data.client_name || 'Client à préciser')+'</h3>' +
          '<p>'+safe(quote.data.event_date ? dateLabel(quote.data.event_date) : 'Date à préciser')+'</p>' +
          '<p>'+safe(officialTotals(quote.data).pending ? 'Montant TTC à préciser' : 'Montant TTC : '+officialMoney(officialTotals(quote.data).ttc))+'</p>' +
          (quote.sent_at ? '<p class="small quote-email-sent">E-mail transmis le '+safe(quote.sent_at)+'</p>' : '') +
          '<p class="small">'+(finalized ? 'Consulter le devis →' : 'Modifier le brouillon →')+'</p></button>' +
          '<div class="document-pdf-actions" aria-label="PDF du devis '+safe(quote.number)+'">' +
          '<button type="button" class="secondary" data-quote-pdf-preview="'+quote.id+'" aria-label="Visualiser le PDF du devis '+safe(quote.number)+'">Visualiser le PDF</button>' +
          (finalized ? '<button type="button" class="secondary" data-quote-pdf-download="'+quote.id+'" aria-label="Télécharger le PDF du devis '+safe(quote.number)+'">Télécharger le PDF</button>' : '') +
          '</div></article>';
      }).join('')
    : '<p class="empty">Aucun devis enregistré pour le moment. Clique sur « Nouveau devis ».</p>';
}

async function loadOfficialQuotes() {
  if (!state.logged) return;
  try {
    const data = await callApi('/api/admin/quotes');
    officialQuoteState.quotes = data.quotes || [];
    officialQuoteState.issuer = data.issuer || {};
    officialQuoteState.mailReady = data.email_ready === true;
    renderOfficialQuotes();
  } catch(error) { notify(error.message); }
}
$('newQuote').addEventListener('click',()=>fillQuoteForm());
$('closeQuote').addEventListener('click',()=>{$('quoteFormPanel').hidden = true;officialQuoteState.current = null;});
$('quoteBooking').addEventListener('change',fillFromBooking);
$('addQuoteLine').addEventListener('click',()=>quoteLine());
$('officialQuotesList').addEventListener('click',event => {
  const pdfButton=event.target.closest('[data-quote-pdf-preview],[data-quote-pdf-download]');
  if(pdfButton){
    const download=pdfButton.hasAttribute('data-quote-pdf-download');
    const id=download?pdfButton.dataset.quotePdfDownload:pdfButton.dataset.quotePdfPreview;
    const quote=officialQuoteState.quotes.find(item=>String(item.id)===id);
    if(quote)showOfficialQuotePdf(download,quote,pdfButton);
    return;
  }
  const card = event.target.closest('[data-quote-id]');
  if (!card) return;
  const quote = officialQuoteState.quotes.find(item => String(item.id) === card.dataset.quoteId);
  if (quote) fillQuoteForm(quote);
});
// Même principe que la suppression des demandes : bouton, confirmation, puis DELETE.
let pendingQuoteDeletion = null;
const deleteQuoteDialog = $('deleteQuoteDialog');
$('deleteOfficialQuote').addEventListener('click', () => {
  const quote = officialQuoteState.current;
  if (!quote) return;
  pendingQuoteDeletion = quote.id;
  $('deleteQuoteMessage').textContent = 'Es-tu vraiment sûr de vouloir supprimer ce devis ?';
  $('deleteQuoteDetails').textContent =
    quote.number + ' · ' + (quote.data.client_name || 'Client non précisé') +
    ' · ' + (quote.status === 'finalise' ? 'Devis finalisé' : 'Brouillon');
  $('deleteFinalQuoteWarning').hidden = quote.status !== 'finalise';
  deleteQuoteDialog.showModal();
});
$('cancelDeleteQuote').addEventListener('click', () => {
  pendingQuoteDeletion = null;
  deleteQuoteDialog.close();
});
deleteQuoteDialog.addEventListener('close', () => {
  pendingQuoteDeletion = null;
});
$('confirmDeleteQuote').addEventListener('click', async () => {
  const id = pendingQuoteDeletion;
  if (!Number.isSafeInteger(id) || id < 1) return;
  const button = $('confirmDeleteQuote');
  button.disabled = true;
  try {
    await callApi('/api/admin/quotes/' + encodeURIComponent(id), { method:'DELETE' });
    // Les autres devis et les demandes clients restent intacts.
    officialQuoteState.quotes = officialQuoteState.quotes.filter(quote => quote.id !== id);
    officialQuoteState.current = null;
    pendingQuoteDeletion = null;
    deleteQuoteDialog.close();
    $('quoteFormPanel').hidden = true;
    renderOfficialQuotes();
    // La demande liée perd automatiquement son indicateur si ce devis était le dernier.
    await refresh();
    notify('Le devis a été supprimé définitivement.');
  } catch (error) {
    $('deleteQuoteMessage').textContent = 'Suppression impossible : ' + error.message;
  } finally {
    button.disabled = false;
  }
});
// Envoi volontaire : devis finalisé, adresse préremplie mais modifiable
// par le musicien (même sans demande client), puis confirmation explicite.
let pendingSendQuote = null;
const sendQuoteDialog = $('sendQuoteDialog');
const quoteRecipientValid = value => {
  const email=String(value||'').trim();
  return email.length<=254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email);
};
function updateQuoteSendRecipient(){
  const recipient=$('sendQuoteEmail').value.trim();
  $('sendQuoteDestination').textContent=recipient
    ? 'Destinataire du devis PDF : '+recipient
    : 'Renseigne une adresse e-mail pour envoyer le devis PDF.';
  $('confirmSendQuote').disabled=!officialQuoteState.mailReady||!quoteRecipientValid(recipient);
}
$('sendQuoteEmail').addEventListener('input',updateQuoteSendRecipient);
$('sendOfficialQuote').addEventListener('click',()=>{
  const quote=officialQuoteState.current;
  if(!quote || quote.status!=='finalise')return;
  const request=state.items.find(item=>item.id===quote.booking_id);
  pendingSendQuote=quote.id;
  $('sendQuoteInfo').textContent='Vérifie le destinataire avant d’envoyer le devis '+quote.number+' par e-mail.';
  $('sendQuoteEmail').value=quote.data?.client_email||request?.email||'';
  $('sendQuoteMessage').value='';
  $('sendQuoteUnavailable').hidden=officialQuoteState.mailReady;
  $('sendQuotePreviously').hidden=!quote.sent_at;
  updateQuoteSendRecipient();
  sendQuoteDialog.showModal();
});
$('cancelSendQuote').addEventListener('click',()=>{
  pendingSendQuote=null;
  sendQuoteDialog.close();
});
sendQuoteDialog.addEventListener('close',()=>{pendingSendQuote=null;});
$('confirmSendQuote').addEventListener('click',async()=>{
  const id=pendingSendQuote;
  if(!Number.isSafeInteger(id)||id<1 || !officialQuoteState.mailReady)return;
  const recipient=$('sendQuoteEmail').value.trim();
  const personalMessage=$('sendQuoteMessage').value.trim();
  if(personalMessage.length>2000){
    $('sendQuoteInfo').textContent='Le message doit contenir au maximum 2 000 caractères.';
    return;
  }
  if(!quoteRecipientValid(recipient)){
    notify('Renseigne une seule adresse e-mail valide pour le destinataire.');
    updateQuoteSendRecipient();
    return;
  }
  const button=$('confirmSendQuote');
  button.disabled=true;
  $('sendQuoteEmail').disabled=true;
  $('sendQuoteMessage').disabled=true;
  $('sendQuoteInfo').textContent='Envoi du devis PDF vers '+recipient+'…';
  try{
    const result=await jsonCall('/api/admin/quotes/'+encodeURIComponent(id)+'/send','POST',
      {confirm_send:true,recipient,personal_message:personalMessage});
    pendingSendQuote=null;
    sendQuoteDialog.close();
    await loadOfficialQuotes();
    const updated=officialQuoteState.quotes.find(q=>q.id===id);
    if(updated){officialQuoteState.current=updated;updateQuoteLock();}
    await refresh();
    notify(result.recorded
      ? 'Le service de messagerie a accepté l’envoi du devis PDF à '+result.recipient+'.'
      : 'Le service de messagerie a accepté l’envoi à '+result.recipient+
        ', mais l’historique n’a pas pu être enregistré. Vérifie avant de renvoyer.');
  }catch(error){
    $('sendQuoteInfo').textContent='Envoi non effectué : '+error.message;
  }finally{
    $('sendQuoteEmail').disabled=false;
    $('sendQuoteMessage').disabled=false;
    updateQuoteSendRecipient();
  }
});
$('saveQuoteProfile').addEventListener('click',async () => {
  const button = $('saveQuoteProfile');
  const data = Object.fromEntries(officialIssuerFields.map(key=>[key,officialQuoteForm.elements.namedItem(key).value]));
  // Le profil partagé peut mémoriser un n° de TVA saisi dans les factures ;
  // le formulaire devis ne propose pas ce champ et ne doit pas l'effacer.
  data.issuer_tax_number=officialQuoteState.issuer?.issuer_tax_number||'';
  button.disabled = true;
  try {
    const result = await jsonCall('/api/admin/quotes','POST',{action:'profile',data});
    officialQuoteState.issuer = result.issuer;
    if(typeof invoiceState!=='undefined')invoiceState.issuer=result.issuer;
    notify('Coordonnées de la structure mémorisées pour les prochains devis et factures.');
  } catch(error) { notify(error.message); }
  finally { button.disabled = false; }
});
async function saveOfficialQuote(finalize = false) {
  if (officialQuoteState.current?.status === 'finalise') return;
  let data;
  try { data = collectOfficialQuote(); }
  catch(error) { notify(error.message);return; }
  if (finalize && !window.confirm('Finaliser et verrouiller ce devis ? Vérifie les coordonnées légales, les prix et les conditions avant de continuer.')) return;
  const saveButton = $('saveOfficialQuote');
  const finalButton = $('finalizeOfficialQuote');
  saveButton.disabled = true; finalButton.disabled = true;
  try {
    const response = await jsonCall('/api/admin/quotes','POST',{
      action:finalize ? 'finalize' : 'save',
      id:officialQuoteState.current?.id ?? null,
      booking_id:$('quoteBooking').value || null,
      data
    });
    await loadOfficialQuotes();
    // Met à jour immédiatement le badge sur la demande liée, sans actualiser la page.
    await refresh();
    // Refermer le formulaire après la sauvegarde : les actions PDF
    // restent visibles sous la carte du document dans la liste.
    $('quoteFormPanel').hidden=true;
    officialQuoteState.current=null;
    renderOfficialQuotes();
    const selected=Array.from($('officialQuotesList').querySelectorAll('[data-quote-id]'))
      .find(el=>el.dataset.quoteId===String(response.quote.id));
    if(selected){
      selected.focus({preventScroll:true});
      selected.scrollIntoView({block:'center',behavior:'smooth'});
    }
    notify(finalize
      ? 'Devis finalisé. Visualise ou télécharge son PDF sous le devis.'
      : 'Brouillon enregistré. Visualise son PDF sous le devis ou rouvre-le pour le modifier.');
  } catch(error) { notify(error.message); }
  finally { saveButton.disabled = false; finalButton.disabled = false; }
}
$('saveOfficialQuote').addEventListener('click',()=>saveOfficialQuote(false));
$('finalizeOfficialQuote').addEventListener('click',()=>saveOfficialQuote(true));
// Le PDF consulté est strictement celui produit par l'API sécurisée pour
// les pièces jointes envoyées aux clients. Aucun doublon de modèle HTML.
const openQuotePdfUrls=new Set();
window.addEventListener('pagehide',()=>{
  for(const url of openQuotePdfUrls)URL.revokeObjectURL(url);
  openQuotePdfUrls.clear();
});
function saveQuotePdfBlob(url,filename){
  const link=document.createElement('a');
  link.href=url;link.download=filename;
  document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>{URL.revokeObjectURL(url);openQuotePdfUrls.delete(url);},60000);
}
async function showOfficialQuotePdf(download=false,selectedQuote=null,actionButton=null){
  const quote=selectedQuote||officialQuoteState.current;
  if(!quote?.id){notify('Enregistre le devis avant de consulter son PDF.');return;}
  if(download&&quote.status!=='finalise'){
    notify('Le téléchargement est réservé aux devis finalisés.');
    return;
  }
  const preview=$('printOfficialQuote'),save=$('downloadOfficialQuote');
  preview.disabled=save.disabled=true;
  if(actionButton)actionButton.disabled=true;
  try{
    const response=await fetch('/api/admin/quotes/'+encodeURIComponent(quote.id)+'/pdf',{
      credentials:'same-origin',cache:'no-store',headers:{Accept:'application/pdf'}
    });
    if(!response.ok){
      if(response.status===401)throw Error('Session expirée. Reconnecte-toi au Manager.');
      throw Error('Le PDF du devis est indisponible.');
    }
    if(!String(response.headers.get('Content-Type')||'').includes('application/pdf'))
      throw Error('Le serveur n’a pas renvoyé un PDF.');
    const blob=await response.blob();
    if(!blob.size)throw Error('Le devis PDF est vide.');
    const url=URL.createObjectURL(blob);
    openQuotePdfUrls.add(url);
    const name=(quote.number||'DEVIS-BROUILLON')+'.pdf';
    if(download)saveQuotePdfBlob(url,name);
    else showManagerPdfPreview(url,quote.number||'Brouillon de devis','devis');
  }catch(error){
    notify('PDF non ouvert : '+error.message);
  }finally{
    const current=officialQuoteState.current;
    preview.disabled=!current?.id;
    save.disabled=!current?.id||current.status!=='finalise';
    if(actionButton&&actionButton.isConnected)actionButton.disabled=false;
  }
}
$('printOfficialQuote').addEventListener('click',()=>showOfficialQuotePdf(false));
$('downloadOfficialQuote').addEventListener('click',()=>showOfficialQuotePdf(true));
document.querySelector('[data-tab="devis"]').addEventListener('click',loadOfficialQuotes);
