'use strict';

// Éditeur privé de devis. Tous les documents sont conservés dans D1,
// chaque devis finalisé devient non modifiable.
const officialQuoteState = {quotes:[],issuer:{},current:null,mailReady:false};
const officialQuoteFields = [
  'issuer_name','issuer_address','issuer_identifier','issuer_contact','issuer_legal',
  'client_name','client_address','client_email','event_date','event_time','event_location',
  'issue_date','valid_until','payment_terms','description','conditions'
];
const officialIssuerFields = ['issuer_name','issuer_address','issuer_identifier','issuer_contact','issuer_legal'];
const directQuotePricing = () => !officialQuoteState.current ||
  officialQuoteState.current.data?.vat_mode === 'ttc_sans_ventilation';
const officialQuoteForm = $('officialQuoteForm');
const officialMoney = cents => (cents / 100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
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
  const locked = officialQuoteState.current?.status === 'finalise';
  for (const control of officialQuoteForm.querySelectorAll('input,textarea,select,button')) {
    control.disabled = locked;
  }
  $('quoteLocked').hidden = !locked;
  $('printOfficialQuote').disabled = !officialQuoteState.current;
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
      officialQuoteForm.elements.namedItem(key).value = officialQuoteState.issuer[key] || '';
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
    ? 'Saisis directement les prix TTC proposés au client. Ajoute une ligne pour les frais de déplacement si nécessaire.'
    : 'Ancien devis : les prix sont indiqués HT. Le calcul fiscal d’origine reste conservé.';
  const lines = data.lines?.length ? data.lines : [{label:'',qty:1,price_cents:0}];
  for (const line of lines) quoteLine(line.label,line.qty,line.price_cents);
  $('quoteFormTitle').textContent = record ? 'Devis '+record.number : 'Nouveau devis';
  $('quoteNumber').textContent = record
    ? record.number+' · '+(record.status === 'finalise' ? 'Finalisé' : 'Brouillon')
    : 'Un numéro de devis sera attribué lors du premier enregistrement.';
  $('quoteFormPanel').hidden = false;
  $('deleteOfficialQuote').hidden = !record;
  updateOfficialTotals();
  updateQuoteLock();
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
        return '<button type="button" class="booking-card" data-quote-id="'+quote.id+'">' +
        '<div class="card-top"><span class="date">'+safe(quote.number)+'</span>' +
        '<span class="tag '+(quote.status === 'finalise'?'confirmed':'pending')+'">'+
        (quote.status === 'finalise'?'Finalisé':'Brouillon')+'</span></div>' +
        '<h3>'+safe(quote.data.client_name || 'Client à préciser')+'</h3>' +
        '<p>'+safe(quote.data.event_date ? dateLabel(quote.data.event_date) : 'Date à préciser')+'</p>' +
        '<p>'+safe(officialTotals(quote.data).pending ? 'Montant TTC à préciser' : 'Montant TTC : '+officialMoney(officialTotals(quote.data).ttc))+'</p>' +
        (quote.sent_at ? '<p class="small quote-email-sent">E-mail transmis le '+safe(quote.sent_at)+'</p>' : '') +
        '<p class="small">Ouvrir le devis →</p></button>';
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
  if(!quoteRecipientValid(recipient)){
    notify('Renseigne une seule adresse e-mail valide pour le destinataire.');
    updateQuoteSendRecipient();
    return;
  }
  const button=$('confirmSendQuote');
  button.disabled=true;
  $('sendQuoteEmail').disabled=true;
  $('sendQuoteInfo').textContent='Envoi du devis PDF vers '+recipient+'…';
  try{
    const result=await jsonCall('/api/admin/quotes/'+encodeURIComponent(id)+'/send','POST',{confirm_send:true,recipient});
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
    updateQuoteSendRecipient();
  }
});
$('saveQuoteProfile').addEventListener('click',async () => {
  const button = $('saveQuoteProfile');
  const data = Object.fromEntries(officialIssuerFields.map(key=>[key,officialQuoteForm.elements.namedItem(key).value]));
  button.disabled = true;
  try {
    const result = await jsonCall('/api/admin/quotes','POST',{action:'profile',data});
    officialQuoteState.issuer = result.issuer;
    notify('Coordonnées de la structure mémorisées pour les prochains devis.');
  } catch(error) { notify(error.message); }
  finally { button.disabled = false; }
});
async function saveOfficialQuote(finalize = false) {
  if (officialQuoteState.current?.status === 'finalise') return;
  let data;
  try { data = collectOfficialQuote(); }
  catch(error) { notify(error.message);return; }
  if (finalize && !window.confirm('Finaliser et verrouiller ce devis ? Vérifie les coordonnées légales, la TVA, les prix et les conditions avant de continuer.')) return;
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
    fillQuoteForm(response.quote);
    notify(finalize
      ? 'Devis finalisé et verrouillé. Tu peux l’imprimer en PDF et le transmettre manuellement après vérification.'
      : 'Brouillon du devis enregistré.');
  } catch(error) { notify(error.message); }
  finally { saveButton.disabled = false; finalButton.disabled = false; }
}
$('saveOfficialQuote').addEventListener('click',()=>saveOfficialQuote(false));
$('finalizeOfficialQuote').addEventListener('click',()=>saveOfficialQuote(true));
function quoteDocumentHtml(quote) {
  // Memes colonnes et totaux TTC que la piece jointe PDF envoyee par Hotmail.
  // Le devis imprime s'inspire du modele HAPPY LIVE 66 fourni par le groupe.
  const data=quote.data;
  const safe=value=>escapeHtml(String(value??''));
  const htmlLine=value=>safe(value).replace(/\n/g,'<br>');
  const totals=officialTotals(data);
  const taxable=!totals.pending;
  const direct=totals.direct;
  const rate=direct || !taxable || data.vat_mode==='franchise'?0:Number(data.vat_mode);
  let cumulativeHT=0,previousTax=0;
  const rows=data.lines.map(line=>{
    const ht=Math.round(line.qty*line.price_cents);
    cumulativeHT+=ht;
    const currentTax=Math.round(cumulativeHT*rate/100);
    const displayed=taxable?ht+currentTax-previousTax:ht;
    previousTax=currentTax;
    return '<tr><td>'+safe(line.label)+'</td><td class="number">'+
      safe(Number(line.qty).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}))+
      '</td><td class="number">'+safe(officialMoney(taxable?
        Math.round(line.price_cents*(100+rate)/100):line.price_cents))+
      '</td><td class="number">'+safe(officialMoney(displayed))+'</td></tr>';
  }).join('');
  const brand=/happy\s*live\s*66/i.test(data.issuer_name||'')?'Happy Live 66':'Les Klosques';
  const taxLabel=data.vat_mode==='franchise'?'TVA non applicable':('TVA '+safe(data.vat_mode)+' %');
  const draftLabel=quote.status==='finalise'?'':'<p class="draft">BROUILLON - NE PAS TRANSMETTRE</p>';
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8">'+
    '<title>'+safe(quote.number)+' - Les Klosques</title>'+
    '<style>'+
    '@page{size:A4;margin:17mm}*{box-sizing:border-box}'+
    'body{font:10px/1.45 Arial,Helvetica,sans-serif;color:#2d2d2d;margin:0;background:#fff}'+
    '.sheet{position:relative;max-width:176mm;margin:0 auto}'+
    '.top{min-height:108px;position:relative;display:flex;align-items:center;padding:19px 0 0 30px;gap:20px}'+
    '.faders{display:flex;gap:20px;height:54px;align-items:center}'+
    '.faders i{height:46px;width:1px;background:#989f9f;display:block;position:relative}'+
    '.faders i:after{content:"";display:block;position:absolute;left:-5px;top:9px;width:11px;height:7px;background:#a1a7a6;border:1px solid #828b89}'+
    '.faders i:nth-child(2):after{top:23px}.faders i:nth-child(3):after{top:13px}.faders i:nth-child(4):after{top:34px}'+
    '.brand{font:italic bold 19px Georgia,serif;color:#666;margin:0}'+
    '.document-label{position:absolute;right:22px;bottom:0;font-size:17px;color:#e3e3e3;letter-spacing:2px}'+
    '.identity{display:grid;grid-template-columns:52% 48%;gap:13px;margin-top:25px;min-height:170px}'+
    '.identity strong{font-size:9px}.issuer,.metadata,.client{overflow-wrap:anywhere}'+
    '.issuer p,.metadata p,.client p{margin:3px 0}'+
    '.metadata{padding-top:9px}.client{margin-top:48px;font-size:10px}'+
    '.event{margin:6px 0 24px;font-size:9px;min-height:26px}'+
    'table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:9px}'+
    'th,td{border:1px solid #cacaca;padding:7px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}'+
    'th{text-align:center;background:#f8f8f8;font-size:8px;font-weight:700}'+
    'td.number{text-align:right;white-space:nowrap}'+
    'th:nth-child(1){width:48%}th:nth-child(2){width:10%}th:nth-child(3){width:24%}th:nth-child(4){width:18%}'+
    '.totals{width:41%;margin-left:auto;margin-top:0}'+
    '.totals td{padding:5px 6px}.totals .label{font-size:8.5px;text-align:right;width:57%}'+
    '.totals .price{text-align:right;white-space:nowrap}.totals .grand{font-weight:700;background:#f6f6f6}'+
    '.vat-note{font-size:8px;text-align:right;margin:6px 0;color:#555}'+
    '.payment{margin-top:52px;white-space:normal;font-size:9px}'+
    '.payment p{margin:5px 0}.agreement{margin-top:35px;font-size:9px}'+
    '.signature-line{margin-top:40px;border-bottom:1px solid #aaa;width:44%}'+
    '.draft{border:1px solid #b22;color:#b22;font-size:15px;font-weight:bold;padding:8px;text-align:center}'+
    '.actions{margin:26px 0}button{border:0;background:#333;color:white;padding:10px 16px;cursor:pointer}'+
    '@media print{.actions{display:none}.sheet{max-width:none}thead{display:table-header-group}tr{break-inside:avoid}}'+
    '</style></head><body><main class="sheet">'+
    '<div class="top"><div class="faders" aria-hidden="true"><i></i><i></i><i></i><i></i></div>'+
    '<h1 class="brand">'+safe(brand)+'</h1><span class="document-label">DEVIS</span></div>'+
    draftLabel+
    '<section class="identity"><div class="issuer"><strong>'+safe(data.issuer_name||'Structure émettrice')+'</strong>'+
    '<p>'+htmlLine(data.issuer_address)+'</p>'+
    (data.issuer_identifier?'<p>Identifiant : '+safe(data.issuer_identifier)+'</p>':'')+
    (data.issuer_tax_number?'<p>TVA : '+safe(data.issuer_tax_number)+'</p>':'')+
    (data.issuer_contact?'<p>'+htmlLine(data.issuer_contact)+'</p>':'')+
    (data.issuer_legal?'<p>'+htmlLine(data.issuer_legal)+'</p>':'')+
    '</div><div><div class="metadata"><p><strong>DATE :</strong> '+safe(dateLabel(data.issue_date))+'</p>'+
    '<p><strong>N° DEVIS :</strong> '+safe(quote.number)+'</p>'+
    '<p><strong>VALABLE JUSQU’AU :</strong> '+safe(dateLabel(data.valid_until))+'</p></div>'+
    '<div class="client"><p><strong>À : '+safe(data.client_name)+'</strong></p>'+
    '<p>'+htmlLine(data.client_address)+'</p>'+
    (data.client_email?'<p>'+safe(data.client_email)+'</p>':'')+
    '</div></div></section>'+
    '<p class="event"><strong>PRESTATION :</strong> '+safe(dateLabel(data.event_date))+
    (data.event_time?' à '+safe(data.event_time):'')+
    (data.event_location?' - '+safe(data.event_location):'')+
    (data.description?'<br>'+htmlLine(data.description):'')+'</p>'+
    '<table><thead><tr><th>DESCRIPTION</th><th>QUANTITÉ</th><th>PRIX UNITAIRE ('+
    (taxable?'TTC':'HT')+')</th><th>MONTANT ('+(taxable?'TTC':'HT')+
    ')</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<table class="totals"><tbody><tr><td class="label">'+(direct?'SOUS-TOTAL':'SOUS-TOTAL HT')+
    '</td><td class="price">'+safe(officialMoney(totals.ht))+'</td></tr>'+
    (direct?'':'<tr><td class="label">'+(taxable?taxLabel:'TVA À PRÉCISER')+
    '</td><td class="price">'+safe(taxable?officialMoney(totals.vat):'—')+'</td></tr>')+
    '<tr class="grand"><td class="label">TOTAL TTC</td><td class="price">'+
    safe(taxable?officialMoney(totals.ttc):'À préciser')+'</td></tr></tbody></table>'+
    (data.vat_mode==='franchise'?'<p class="vat-note">TVA non applicable, art. 293 B du CGI</p>':'')+
    '<section class="payment"><p>Ordre du règlement : '+safe(data.issuer_name)+'</p>'+
    '<p>Modalités de paiement : '+htmlLine(data.payment_terms)+'</p>'+
    (data.conditions?'<p>Conditions particulières : '+htmlLine(data.conditions)+'</p>':'')+
    '</section><div class="agreement">Bon pour accord - date et signature du client :'+
    '<div class="signature-line"></div></div>'+
    '<div class="actions"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>'+
    '</main></body></html>';
}
$('printOfficialQuote').addEventListener('click',()=> {
  const quote = officialQuoteState.current;
  if (!quote) return;
  const win = window.open('','_blank');
  if (!win) {notify('Autorise les fenêtres contextuelles pour imprimer le devis.');return;}
  win.document.open();
  win.document.write(quoteDocumentHtml(quote));
  win.document.close();
  win.focus();
});
document.querySelector('[data-tab="devis"]').addEventListener('click',loadOfficialQuotes);
