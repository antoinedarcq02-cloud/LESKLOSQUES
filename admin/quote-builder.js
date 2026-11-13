'use strict';

// Éditeur privé de devis. Tous les documents sont conservés dans D1,
// chaque devis finalisé devient non modifiable.
const officialQuoteState = {quotes:[],issuer:{},current:null};
const officialQuoteFields = [
  'issuer_name','issuer_address','issuer_identifier','issuer_tax_number','issuer_contact','issuer_legal',
  'client_name','client_address','client_email','event_date','event_time','event_location',
  'issue_date','valid_until','payment_terms','description','conditions','vat_mode'
];
const officialIssuerFields = ['issuer_name','issuer_address','issuer_identifier','issuer_tax_number','issuer_contact','issuer_legal'];
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
  price.setAttribute('aria-label','Prix HT en euros'); price.className = 'quote-line-price'; price.value = priceCents ? (priceCents/100).toFixed(2) : '';
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
  const pending = data.vat_mode === 'non_precise';
  const percent = pending || data.vat_mode === 'franchise' ? 0 : Number(data.vat_mode);
  const vat = Math.round(ht * percent / 100);
  return {ht,vat,ttc:ht+vat,pending};
}
function updateOfficialTotals() {
  try {
    const data = collectOfficialQuote();
    const t = officialTotals(data);
    $('quoteTotals').textContent = t.pending
      ? 'Total HT : ' + officialMoney(t.ht) + ' · TVA et TTC : à préciser'
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
}
function fillQuoteForm(record = null) {
  officialQuoteState.current = record;
  officialQuoteForm.reset();
  $('quoteLines').replaceChildren();
  populateBookingSelect();
  const data = record?.data || {};
  for (const field of officialQuoteFields) {
    const input = officialQuoteForm.elements.namedItem(field);
    if (input) input.value = data[field] || (field === 'vat_mode' ? 'non_precise' : '');
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
  const lines = data.lines?.length ? data.lines : [{label:'Prestation musicale Les Klosques',qty:1,price_cents:0}];
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
  if (booking.package) {
    $('quoteLines').replaceChildren();
    quoteLine(booking.package,1,booking.quote_amount_cents || 0);
  }
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
    renderOfficialQuotes();
  } catch(error) { notify(error.message); }
}
$('newQuote').addEventListener('click',()=>fillQuoteForm());
$('closeQuote').addEventListener('click',()=>{$('quoteFormPanel').hidden = true;officialQuoteState.current = null;});
$('quoteBooking').addEventListener('change',fillFromBooking);
$('addQuoteLine').addEventListener('click',()=>quoteLine());
officialQuoteForm.elements.namedItem('vat_mode').addEventListener('change',updateOfficialTotals);
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
  const data = quote.data;
  const safe = value => escapeHtml(value || '');
  const htmlLine = value => safe(value).replace(/\n/g,'<br>');
  const total = officialTotals(data);
  const isFinal = quote.status === 'finalise';
  const rows = data.lines.map(line => {
    const unit = officialMoney(line.price_cents);
    return '<tr><td>'+safe(line.label)+'</td><td>'+safe(String(line.qty))+
      '</td><td>'+safe(unit)+'</td><td>'+safe(officialMoney(Math.round(line.qty*line.price_cents)))+'</td></tr>';
  }).join('');
  const vat = total.pending ? 'Régime de TVA à préciser avant transmission'
    : data.vat_mode === 'franchise' ? 'TVA non applicable, art. 293 B du CGI'
    : 'TVA '+safe(data.vat_mode)+' %';
  const draftLabel = isFinal ? '' : '<p class="draft">BROUILLON INTERNE — À COMPLÉTER AVANT ENVOI</p>';
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8">'+
    '<title>'+safe(quote.number)+' — Les Klosques</title>'+
    '<style>@page{size:A4;margin:17mm}*{box-sizing:border-box}body{font:12px/1.48 Arial,sans-serif;color:#171717;margin:0}h1{font-size:33px;color:#b32239;margin:0}h2{font-size:14px;margin:20px 0 7px;color:#8b1d31}header{border-bottom:3px solid #b32239;padding-bottom:15px;margin-bottom:20px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}.block{white-space:normal;overflow-wrap:anywhere}.muted{color:#575757}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border-bottom:1px solid #bbb;padding:8px 6px;text-align:left;vertical-align:top}th{background:#f0ecef}td:nth-child(n+2),th:nth-child(n+2){text-align:right}.total{margin-left:auto;width:270px;padding:10px 0;font-size:13px}.total div{display:flex;justify-content:space-between;padding:4px 0}.grand{border-top:2px solid #222;font-weight:800;font-size:16px}.signature{margin-top:34px;display:grid;grid-template-columns:1fr 1fr;gap:30px}.signature>div{border-top:1px solid #aaa;padding-top:8px;min-height:70px}.draft{font-size:16px;font-weight:800;color:#af2035;background:#fff0f1;border:2px solid #af2035;padding:14px;text-align:center}p{margin:7px 0}.conditions{white-space:normal;overflow-wrap:anywhere}.actions{margin:25px 0}@media print{.actions{display:none}}button{padding:10px 18px;background:#b32239;color:#fff;border:0;border-radius:5px;cursor:pointer}tr{break-inside:avoid}</style>'+
    '</head><body>'+
    '<header><h1>DEVIS</h1><p><strong>'+safe(quote.number)+'</strong> · Émis le '+safe(dateLabel(data.issue_date))+
    ' · Valable jusqu’au '+safe(dateLabel(data.valid_until))+'</p></header>'+draftLabel+
    '<div class="columns"><div class="block"><h2>Prestataire / émetteur</h2><strong>'+safe(data.issuer_name)+'</strong><p>'+htmlLine(data.issuer_address)+'</p>'+
    '<p>Identifiant : '+safe(data.issuer_identifier)+'</p>'+
    (data.issuer_tax_number?'<p>TVA intracommunautaire : '+safe(data.issuer_tax_number)+'</p>':'')+
    (data.issuer_contact?'<p>'+htmlLine(data.issuer_contact)+'</p>':'')+
    (data.issuer_legal?'<p>'+htmlLine(data.issuer_legal)+'</p>':'')+'</div>'+
    '<div class="block"><h2>Client / organisateur</h2><strong>'+safe(data.client_name)+'</strong>'+
    '<p>'+htmlLine(data.client_address)+'</p>'+(data.client_email?'<p>'+safe(data.client_email)+'</p>':'')+'</div></div>'+
    '<h2>Événement et prestation</h2>'+
    '<p><strong>Date :</strong> '+safe(dateLabel(data.event_date))+
    (data.event_time?' à '+safe(data.event_time):'')+' · <strong>Lieu :</strong> '+safe(data.event_location)+'</p>'+
    (data.description?'<p>'+htmlLine(data.description)+'</p>':'')+
    '<table><thead><tr><th>Prestation</th><th>Quantité</th><th>Prix unitaire HT</th><th>Total HT</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table>'+
    '<div class="total"><div><span>Total HT</span><strong>'+safe(officialMoney(total.ht))+'</strong></div>'+
    '<div><span>TVA</span><strong>'+safe(total.pending ? 'À préciser' : officialMoney(total.vat))+'</strong></div>'+
    '<div class="grand"><span>TOTAL TTC</span><strong>'+safe(total.pending ? 'À préciser' : officialMoney(total.ttc))+'</strong></div></div>'+
    '<p class="muted">'+vat+'</p>'+
    '<h2>Modalités de paiement</h2><p class="conditions">'+htmlLine(data.payment_terms)+'</p>'+
    (data.conditions?'<h2>Conditions particulières</h2><p class="conditions">'+htmlLine(data.conditions)+'</p>':'')+
    '<div class="signature"><div>Signature du prestataire<br><span class="muted">Date, nom et signature</span></div>'+
    '<div>Bon pour accord — signature du client<br><span class="muted">Date, nom et signature</span></div></div>'+
    '<p class="muted" style="margin-top:18px">Ce devis est une offre de prestation. Les conditions et mentions légales doivent être vérifiées par son émetteur.</p>'+
    '<div class="actions"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>'+
    '</body></html>';
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
