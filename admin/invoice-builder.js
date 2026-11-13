'use strict';

// Factures des Klosques : brouillon modifiable, numéro seulement à l'émission,
// PDF et envoi sous contrôle, aucun envoi lors de la sauvegarde.
const invoiceState={invoices:[],issuer:{},quotes:[],mailReady:false,current:null,testResetCandidateId:null};
const invoiceForm=$('invoiceForm');
const invoiceFields=[
  'issuer_name','issuer_address','issuer_identifier','issuer_tax_number','issuer_contact','issuer_legal',
  'client_name','client_email','client_address','client_type','client_identifier',
  'event_date','event_time','event_location','issue_date','payment_due_date',
  'payment_terms','description','conditions','late_penalties','vat_mode'
];
const invoiceMoney=cents=>(cents/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
// Suivi : émise en attente d'envoi, envoyée en attente de paiement, puis payée.
function invoiceStatusLabel(invoice){
  if(!invoice||invoice.status!=='emise')return 'Brouillon';
  if(invoice.paid)return 'Payée';
  return invoice.sent_at?'En attente de paiement':'En attente d’envoi';
}
const invoiceDate=(value=new Date())=>[
  value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')
].join('-');
function newInvoiceLine(label='',qty=1,priceCents=0){
  if($('invoiceLines').children.length>=12){
    notify('Maximum 12 lignes par facture.');return;
  }
  const row=document.createElement('div');
  row.className='official-quote-line invoice-line';
  const name=document.createElement('input');
  name.className='quote-line-label';name.type='text';name.maxLength=220;
  name.placeholder='Ex. Les Klosques, équipe technique ou DJ';
  name.setAttribute('aria-label','Prestation');name.value=label;
  const quantity=document.createElement('input');
  quantity.className='quote-line-qty';quantity.type='number';quantity.min='0.01';
  quantity.max='1000';quantity.step='0.01';quantity.setAttribute('aria-label','Quantité');
  quantity.value=String(qty);
  const price=document.createElement('input');
  price.className='quote-line-price';price.type='number';price.min='0';price.max='1000000';
  price.step='0.01';price.setAttribute('aria-label','Prix unitaire HT en euros');
  price.value=priceCents?(priceCents/100).toFixed(2):'';
  const remove=document.createElement('button');
  remove.type='button';remove.className='small-button quote-line-remove';remove.textContent='✕';
  remove.setAttribute('aria-label','Supprimer cette ligne');
  for(const field of [name,quantity,price])field.addEventListener('input',updateInvoiceTotal);
  remove.addEventListener('click',()=>{row.remove();updateInvoiceTotal();});
  row.append(name,quantity,price,remove);
  $('invoiceLines').append(row);updateInvoiceTotal();
}
function collectInvoice(){
  const data={};
  for(const field of invoiceFields)data[field]=invoiceForm.elements.namedItem(field).value.trim();
  data.lines=Array.from($('invoiceLines').children).map(row=>{
    const label=row.querySelector('.quote-line-label').value.trim();
    const quantity=row.querySelector('.quote-line-qty').value;
    const price=row.querySelector('.quote-line-price').value;
    const qty=Number(quantity),euros=price===''?0:Number(price);
    if(!Number.isFinite(qty)||qty<=0||qty>1000||
       !Number.isFinite(euros)||euros<0||euros>1000000)
      throw Error('Vérifie les quantités et les tarifs.');
    return{label,qty,price_cents:Math.round(euros*100)};
  }).filter(line=>line.label||line.price_cents);
  return data;
}
function invoiceAmounts(data){
  const ht=(data.lines||[]).reduce((s,line)=>s+Math.round(line.qty*line.price_cents),0);
  const pending=data.vat_mode==='non_precise';
  const percent=pending||data.vat_mode==='franchise'?0:Number(data.vat_mode);
  const vat=Math.round(ht*percent/100);
  return{ht,vat,ttc:ht+vat,pending};
}
function updateInvoiceTotal(){
  try{
    const t=invoiceAmounts(collectInvoice());
    $('invoiceTotals').textContent=t.pending
      ?'Total HT : '+invoiceMoney(t.ht)+' · TVA et TTC : à préciser'
      :'Total HT : '+invoiceMoney(t.ht)+' · TVA : '+invoiceMoney(t.vat)+' · Total TTC : '+invoiceMoney(t.ttc);
  }catch{$('invoiceTotals').textContent='Vérifie les tarifs et quantités.';}
}
function invoiceSelectionOptions(){
  const oldBooking=$('invoiceBooking').value,oldQuote=$('invoiceQuote').value;
  $('invoiceBooking').replaceChildren(new Option('Facture indépendante / sans demande',''));
  for(const item of state.items)$('invoiceBooking').add(new Option(
    item.name+' — '+dateLabel(item.event_date),item.id));
  $('invoiceBooking').value=oldBooking;
  $('invoiceQuote').replaceChildren(new Option('Aucun devis associé',''));
  for(const q of invoiceState.quotes){
    if(q.status==='finalise')
      $('invoiceQuote').add(new Option(q.number+' — '+(q.data.client_name||'Client'),String(q.id)));
  }
  $('invoiceQuote').value=oldQuote;
}
function populateInvoiceFromBooking(){
  const item=state.items.find(x=>x.id===$('invoiceBooking').value);
  if(!item)return;
  const details={
    client_name:item.name,client_email:item.email,event_date:item.event_date,
    event_location:item.location,description:item.message
  };
  for(const [key,value] of Object.entries(details))
    if(value)invoiceForm.elements.namedItem(key).value=value;
  // Ne jamais recopier la formule du site ni un prix global dans les lignes.
}
function populateInvoiceFromQuote(){
  const quote=invoiceState.quotes.find(q=>String(q.id)===$('invoiceQuote').value);
  $('importInvoiceQuote').hidden=!quote;
  if(!quote)return;
  if(quote.booking_id){
    const exists=Array.from($('invoiceBooking').options).some(opt=>opt.value===quote.booking_id);
    if(exists)$('invoiceBooking').value=quote.booking_id;
  }
  const fields=[
    'client_name','client_email','client_address','event_date','event_time',
    'event_location','description','issuer_name','issuer_address',
    'issuer_identifier','issuer_tax_number','issuer_contact','issuer_legal',
    'vat_mode','payment_terms','conditions'
  ];
  for(const key of fields)
    if(quote.data[key])invoiceForm.elements.namedItem(key).value=quote.data[key];
  updateInvoiceTotal();
}
function importInvoiceQuoteLines(){
  const quote=invoiceState.quotes.find(q=>String(q.id)===$('invoiceQuote').value);
  if(!quote||!quote.data.lines?.length){notify('Ce devis ne comporte aucune ligne à reprendre.');return;}
  if($('invoiceLines').children.length>1||
    $('invoiceLines').querySelector('.quote-line-label')?.value.trim()||
    $('invoiceLines').querySelector('.quote-line-price')?.value)
    if(!window.confirm('Remplacer les lignes de cette facture par celles du devis ?'))return;
  $('invoiceLines').replaceChildren();
  for(const row of quote.data.lines)newInvoiceLine(row.label,row.qty,row.price_cents);
  updateInvoiceTotal();
  notify('Prestations reprises du devis. Vérifie les prix avant d’émettre la facture.');
}
function lockInvoiceEditor(){
  const invoice=invoiceState.current;
  const issued=invoice?.status==='emise';
  for(const control of invoiceForm.querySelectorAll('input,textarea,select,button'))
    control.disabled=issued||control.name==='issue_date';
  $('invoiceLocked').hidden=!issued;
  $('deleteInvoiceDraft').hidden=!invoice||issued;
  $('archiveInvoice').hidden=!issued;
  $('archiveInvoice').textContent=invoice?.archived?'Restaurer la facture':'Archiver la facture';
  // Exception très limitée : premier document fictif non envoyé, réservé au responsable.
  $('resetInitialTestInvoice').hidden=!issued||!invoiceState.testResetCandidateId||
    invoice.id!==invoiceState.testResetCandidateId;
  $('saveInvoice').hidden=issued;
  $('issueInvoice').hidden=issued;
  $('printInvoice').disabled=!invoice;
  $('sendInvoice').hidden=!issued;
  $('markInvoicePaid').hidden=!issued;
  $('markInvoicePaid').textContent=invoice?.paid?'Marquer comme non réglée':'Marquer comme payée';
  // Rafraîchit l'en-tête après l'envoi, sans fermer et rouvrir la fiche.
  if(invoice)$('invoiceNumber').textContent=(invoice.number||'Brouillon non numéroté')+' · '+invoiceStatusLabel(invoice);
  const when=invoice?.sent_at;
  $('invoiceEmailHistory').hidden=!when;
  $('invoiceEmailHistory').textContent=when
    ?'Dernier envoi accepté : '+when+' · '+(invoice.sent_to||''):'';
}
function fillInvoice(invoice=null){
  invoiceState.current=invoice;
  invoiceForm.reset();
  $('invoiceLines').replaceChildren();
  invoiceSelectionOptions();
  const data=invoice?.data||{};
  for(const key of invoiceFields){
    const field=invoiceForm.elements.namedItem(key);
    field.value=data[key]||(key==='vat_mode'?'non_precise':key==='client_type'?'particulier':'');
  }
  if(!invoice){
    for(const key of ['issuer_name','issuer_address','issuer_identifier','issuer_tax_number','issuer_contact','issuer_legal'])
      invoiceForm.elements.namedItem(key).value=invoiceState.issuer[key]||'';
    const now=new Date();invoiceForm.elements.namedItem('issue_date').value='';
    invoiceForm.elements.namedItem('payment_due_date').value=invoiceDate(new Date(
      now.getFullYear(),now.getMonth(),now.getDate()+30));
  }
  if(invoice?.booking_id&&!Array.from($('invoiceBooking').options).some(opt=>opt.value===invoice.booking_id))
    $('invoiceBooking').add(new Option('Demande archivée',invoice.booking_id));
  $('invoiceBooking').value=invoice?.booking_id||'';
  if(invoice?.quote_id&&!Array.from($('invoiceQuote').options).some(opt=>opt.value===String(invoice.quote_id)))
    $('invoiceQuote').add(new Option('Devis archivé',String(invoice.quote_id)));
  $('invoiceQuote').value=invoice?.quote_id?String(invoice.quote_id):'';
  $('importInvoiceQuote').hidden=!invoiceState.quotes.some(q=>String(q.id)===$('invoiceQuote').value);
  for(const line of data.lines?.length?data.lines:[{label:'',qty:1,price_cents:0}])
    newInvoiceLine(line.label,line.qty,line.price_cents);
  $('invoiceEditorTitle').textContent=invoice?(invoice.number||'Brouillon de facture'):'Nouvelle facture';
  $('invoiceNumber').textContent=invoice
    ?(invoice.number||'Brouillon non numéroté')+' · '+invoiceStatusLabel(invoice)
    :'Un numéro officiel sera attribué uniquement à l’émission de la facture.';
  $('invoiceEditorPanel').hidden=false;
  updateInvoiceTotal();lockInvoiceEditor();
  $('invoiceEditorPanel').scrollIntoView({block:'start',behavior:'smooth'});
}
function renderInvoices(){
  const showArchived=$('invoiceVisibility').value==='archived';
  const rows=invoiceState.invoices.filter(inv=>Boolean(inv.archived)===showArchived);
  $('invoiceList').innerHTML=rows.length?rows.map(inv=>{
    const safe=escapeHtml,t=invoiceAmounts(inv.data);
    const label=inv.archived?'Archivée · '+invoiceStatusLabel(inv):invoiceStatusLabel(inv);
    const category=inv.paid?'confirmed':inv.status==='emise'?'pending':'';
    return '<button type="button" class="booking-card" data-invoice-id="'+safe(inv.id)+'">'+
      '<div class="card-top"><span class="date">'+safe(inv.number||'Brouillon non numéroté')+'</span>'+
      '<span class="tag '+category+'">'+safe(label)+'</span></div>'+
      '<h3>'+safe(inv.data.client_name||'Client à préciser')+'</h3>'+
      '<p>'+safe(inv.data.event_date?dateLabel(inv.data.event_date):'Date à préciser')+'</p>'+
      '<p>'+safe(t.pending?'Montant TTC à préciser':'Total TTC : '+invoiceMoney(t.ttc))+'</p>'+
      (inv.sent_at?'<p class="small quote-email-sent">E-mail envoyé le '+safe(inv.sent_at)+'</p>':'')+
      '<p class="small">Ouvrir la facture →</p></button>';
  }).join(''):showArchived
    ?'<p class="empty">Aucune facture archivée.</p>'
    :'<p class="empty">Aucune facture en cours. Clique sur « Nouvelle facture ».</p>';
}
async function loadInvoices(){
  if(!state.logged)return;
  try{
    const result=await callApi('/api/admin/invoices');
    invoiceState.invoices=result.invoices||[];
    invoiceState.issuer=result.issuer||{};
    invoiceState.mailReady=result.mail_ready===true;
    invoiceState.testResetCandidateId=result.test_reset_candidate_id||null;
    try{
      const quotes=await callApi('/api/admin/quotes');
      invoiceState.quotes=quotes.quotes||[];
    }catch{invoiceState.quotes=[];}
    renderInvoices();
  }catch(error){notify(error.message);}
}
$('invoiceVisibility').addEventListener('change',()=>{
  $('invoiceEditorPanel').hidden=true;
  invoiceState.current=null;
  renderInvoices();
});
$('newInvoice').addEventListener('click',()=>fillInvoice());
$('closeInvoice').addEventListener('click',()=>{$('invoiceEditorPanel').hidden=true;invoiceState.current=null;});
$('addInvoiceLine').addEventListener('click',()=>newInvoiceLine());
$('invoiceBooking').addEventListener('change',populateInvoiceFromBooking);
$('invoiceQuote').addEventListener('change',populateInvoiceFromQuote);
$('importInvoiceQuote').addEventListener('click',importInvoiceQuoteLines);
invoiceForm.elements.namedItem('vat_mode').addEventListener('change',updateInvoiceTotal);
$('invoiceList').addEventListener('click',event=>{
  const card=event.target.closest('[data-invoice-id]');
  if(!card)return;
  const invoice=invoiceState.invoices.find(i=>i.id===card.dataset.invoiceId);
  if(invoice)fillInvoice(invoice);
});
async function saveInvoice(issue=false){
  if(invoiceState.current?.status==='emise')return;
  let data;
  try{data=collectInvoice();}
  catch(error){notify(error.message);return;}
  if(issue&&!window.confirm(
    'Émettre définitivement cette facture ? Un numéro unique sera attribué. Elle ne pourra ensuite plus être modifiée ni supprimée. Vérifie les informations légales, les prix et la TVA.'
  ))return;
  const save=$('saveInvoice'),final=$('issueInvoice');
  save.disabled=true;final.disabled=true;
  try{
    const response=await jsonCall('/api/admin/invoices','POST',{
      action:issue?'issue':'save',
      id:invoiceState.current?.id??null,
      booking_id:$('invoiceBooking').value||null,
      quote_id:$('invoiceQuote').value?Number($('invoiceQuote').value):null,
      data
    });
    await loadInvoices();
    await refresh();
    fillInvoice(response.invoice);
    notify(issue?'Facture émise : '+response.invoice.number+'. Le numéro et le contenu sont désormais verrouillés.'
      :'Brouillon de facture enregistré.');
  }catch(error){notify(error.message);}
  finally{save.disabled=false;final.disabled=false;}
}
$('saveInvoice').addEventListener('click',()=>saveInvoice(false));
$('issueInvoice').addEventListener('click',()=>saveInvoice(true));
$('printInvoice').addEventListener('click',()=>{
  const invoice=invoiceState.current;
  if(!invoice)return;
  window.open('/api/admin/invoices/'+encodeURIComponent(invoice.id)+'/pdf','_blank','noopener');
});
// Une facture émise ne doit pas être effacée. L'archivage est réversible et
// conserve sa numérotation, son PDF et son historique de paiement et d'e-mails.
let pendingInvoiceArchive=null;
const archiveInvoiceDialog=$('archiveInvoiceDialog');
$('archiveInvoice').addEventListener('click',()=>{
  const invoice=invoiceState.current;
  if(!invoice||invoice.status!=='emise')return;
  const action=invoice.archived?'restore':'archive';
  pendingInvoiceArchive={id:invoice.id,action};
  $('archiveInvoiceTitle').textContent=action==='archive'
    ?'Archiver la facture ?':'Restaurer la facture ?';
  $('archiveInvoiceQuestion').textContent=action==='archive'
    ?'Es-tu sûr de vouloir retirer cette facture de la liste courante ?'
    :'Veux-tu remettre cette facture dans la liste en cours ?';
  $('archiveInvoiceDetails').textContent=
    (invoice.number||'Facture')+' · '+(invoice.data.client_name||'Client non précisé');
  $('confirmArchiveInvoice').textContent=action==='archive'
    ?'Archiver la facture':'Restaurer la facture';
  archiveInvoiceDialog.showModal();
});
$('cancelArchiveInvoice').addEventListener('click',()=>archiveInvoiceDialog.close());
archiveInvoiceDialog.addEventListener('close',()=>{pendingInvoiceArchive=null;});
$('confirmArchiveInvoice').addEventListener('click',async()=>{
  const pending=pendingInvoiceArchive;
  if(!pending)return;
  const button=$('confirmArchiveInvoice');
  button.disabled=true;
  try{
    await jsonCall('/api/admin/invoices/'+encodeURIComponent(pending.id)+'/archive',
      'POST',{action:pending.action});
    archiveInvoiceDialog.close();
    invoiceState.current=null;
    $('invoiceEditorPanel').hidden=true;
    await loadInvoices();
    notify(pending.action==='archive'
      ?'Facture archivée. Elle reste disponible dans « Archives ».'
      :'Facture restaurée dans la liste en cours.');
  }catch(error){notify(error.message);}
  finally{button.disabled=false;}
});
// Suppression exceptionnelle du seul tout premier test : aucun autre document,
// mail ou règlement. Les vérifications sont refaites sur le serveur à l'envoi.
let pendingTestReset=null;
const resetInvoiceDialog=$('resetTestInvoiceDialog');
function updateTestResetConfirmation(){
  $('confirmResetTestInvoice').disabled=!(
    pendingTestReset &&
    $('resetTestInvoiceCheck').checked &&
    $('resetTestInvoiceText').value.trim()==='SUPPRIMER TEST'
  );
}
$('resetInitialTestInvoice').addEventListener('click',()=>{
  const invoice=invoiceState.current;
  if(!invoice||invoice.id!==invoiceState.testResetCandidateId||invoice.status!=='emise')return;
  pendingTestReset=invoice.id;
  $('resetTestInvoiceDescription').textContent=
    'Supprimer définitivement le test '+(invoice.number||'')+
    ' pour '+(invoice.data.client_name||'client non précisé')+
    ' ? Cette action ne concerne que la première facture, unique, jamais envoyée ni réglée.';
  $('resetTestInvoiceCheck').checked=false;
  $('resetTestInvoiceText').value='';
  $('resetTestInvoiceError').hidden=true;
  $('resetTestInvoiceError').textContent='';
  updateTestResetConfirmation();
  resetInvoiceDialog.showModal();
});
$('resetTestInvoiceCheck').addEventListener('change',updateTestResetConfirmation);
$('resetTestInvoiceText').addEventListener('input',updateTestResetConfirmation);
$('cancelResetTestInvoice').addEventListener('click',()=>resetInvoiceDialog.close());
resetInvoiceDialog.addEventListener('close',()=>{
  pendingTestReset=null;
  $('resetTestInvoiceText').value='';
  $('resetTestInvoiceCheck').checked=false;
  $('confirmResetTestInvoice').disabled=true;
});
$('confirmResetTestInvoice').addEventListener('click',async()=>{
  const id=pendingTestReset;
  if(!id||!$('resetTestInvoiceCheck').checked||
      $('resetTestInvoiceText').value.trim()!=='SUPPRIMER TEST')return;
  const button=$('confirmResetTestInvoice');
  button.disabled=true;
  try{
    await jsonCall('/api/admin/invoices/'+encodeURIComponent(id)+'/reset-test','POST',{
      confirmation:'SUPPRIMER TEST',never_used:true
    });
    pendingTestReset=null;
    resetInvoiceDialog.close();
    invoiceState.current=null;
    $('invoiceEditorPanel').hidden=true;
    $('invoiceVisibility').value='current';
    await loadInvoices();
    await refresh();
    notify('La facture d’essai a été retirée. Une trace interne est conservée et la première vraie facture utilisera le numéro initial.');
  }catch(error){
    $('resetTestInvoiceError').textContent='Suppression impossible : '+error.message;
    $('resetTestInvoiceError').hidden=false;
  }finally{
    updateTestResetConfirmation();
  }
});
let pendingInvoiceDelete=null;
const invoiceDeleteDialog=$('deleteInvoiceDialog');
$('deleteInvoiceDraft').addEventListener('click',()=>{
  const invoice=invoiceState.current;
  if(!invoice||invoice.status!=='brouillon')return;
  pendingInvoiceDelete=invoice.id;
  $('deleteInvoiceDetails').textContent='Client : '+(invoice.data.client_name||'Non précisé')+' · Brouillon sans numéro officiel';
  invoiceDeleteDialog.showModal();
});
$('cancelDeleteInvoice').addEventListener('click',()=>invoiceDeleteDialog.close());
invoiceDeleteDialog.addEventListener('close',()=>{pendingInvoiceDelete=null;});
$('confirmDeleteInvoice').addEventListener('click',async()=>{
  const id=pendingInvoiceDelete;if(!id)return;
  const button=$('confirmDeleteInvoice');button.disabled=true;
  try{
    await callApi('/api/admin/invoices/'+encodeURIComponent(id),{method:'DELETE'});
    pendingInvoiceDelete=null;invoiceDeleteDialog.close();
    invoiceState.current=null;$('invoiceEditorPanel').hidden=true;
    await loadInvoices();await refresh();
    notify('Brouillon de facture supprimé.');
  }catch(error){notify(error.message);}
  finally{button.disabled=false;}
});
let pendingInvoicePayment=null;
const paymentDialog=$('payInvoiceDialog');
$('markInvoicePaid').addEventListener('click',()=>{
  const invoice=invoiceState.current;
  if(!invoice||invoice.status!=='emise')return;
  pendingInvoicePayment={id:invoice.id,paid:!invoice.paid};
  $('payInvoiceMessage').textContent=invoice.paid?
    'Marquer cette facture comme non réglée ?':'Confirmer que cette facture a été réglée ?';
  paymentDialog.showModal();
});
$('cancelPayInvoice').addEventListener('click',()=>paymentDialog.close());
paymentDialog.addEventListener('close',()=>{pendingInvoicePayment=null;});
$('confirmPayInvoice').addEventListener('click',async()=>{
  const choice=pendingInvoicePayment;if(!choice)return;
  const button=$('confirmPayInvoice');button.disabled=true;
  try{
    const res=await jsonCall('/api/admin/invoices','POST',{
      action:choice.paid?'mark_paid':'mark_unpaid',id:choice.id
    });
    paymentDialog.close();pendingInvoicePayment=null;
    await loadInvoices();await refresh();fillInvoice(invoiceState.invoices.find(i=>i.id===res.invoice.id)||res.invoice);
    notify(choice.paid?'Facture marquée comme payée.':'Facture marquée comme non réglée.');
  }catch(error){notify(error.message);}
  finally{button.disabled=false;}
});
let pendingInvoiceSend=null;
const invoiceSendDialog=$('sendInvoiceDialog');
$('sendInvoice').addEventListener('click',()=>{
  const invoice=invoiceState.current;
  if(!invoice||invoice.status!=='emise')return;
  const linked=state.items.find(item=>item.id===invoice.booking_id);
  const recipient=linked?linked.email:invoice.data.client_email;
  if(!recipient){notify('Renseigne une adresse e-mail client dans le dossier avant l’envoi.');return;}
  pendingInvoiceSend=invoice.id;
  $('invoiceSendDestination').textContent=
    (linked?.name||invoice.data.client_name||'Client')+' — '+recipient+' · '+invoice.number;
  $('invoiceSendWarning').hidden=invoiceState.mailReady;
  $('invoiceSendPreviously').hidden=!invoice.sent_at;
  $('invoiceSendFeedback').textContent='';
  $('confirmSendInvoice').disabled=!invoiceState.mailReady;
  invoiceSendDialog.showModal();
});
$('cancelSendInvoice').addEventListener('click',()=>invoiceSendDialog.close());
invoiceSendDialog.addEventListener('close',()=>{pendingInvoiceSend=null;});
$('confirmSendInvoice').addEventListener('click',async()=>{
  const id=pendingInvoiceSend;if(!id||!invoiceState.mailReady)return;
  const btn=$('confirmSendInvoice');btn.disabled=true;
  $('invoiceSendFeedback').textContent='Envoi en cours…';
  try{
    const response=await jsonCall('/api/admin/invoices/'+encodeURIComponent(id)+'/send',
      'POST',{confirm_send:true});
    pendingInvoiceSend=null;invoiceSendDialog.close();
    await loadInvoices();await refresh();
    const updated=invoiceState.invoices.find(i=>i.id===id);
    if(updated){invoiceState.current=updated;lockInvoiceEditor();}
    notify(response.recorded
      ? 'Le service de messagerie a accepté la facture PDF pour '+response.recipient+'.'
      : 'Le service a accepté la facture PDF pour '+response.recipient+
        ', mais l’historique n’a pas pu être sauvegardé. Vérifie avant de renvoyer.');
  }catch(error){$('invoiceSendFeedback').textContent='Envoi non effectué : '+error.message;}
  finally{btn.disabled=false;}
});
document.querySelector('[data-tab="factures"]').addEventListener('click',loadInvoices);
