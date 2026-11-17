'use strict';

// Factures des Klosques : brouillon modifiable, numéro seulement à l'émission,
// PDF et envoi sous contrôle, aucun envoi lors de la sauvegarde.
const invoiceState={invoices:[],issuer:{},quotes:[],mailReady:false,current:null,testResetCandidateId:null};
const invoiceForm=$('invoiceForm');
const invoiceIssuerFields=['issuer_name','issuer_address','issuer_identifier','issuer_contact','issuer_legal','issuer_tax_number'];
const invoiceFields=[
  'issuer_name','issuer_address','issuer_identifier','issuer_tax_number','issuer_contact','issuer_legal',
  'client_name','client_email','client_address','client_type','client_identifier',
  'event_date','event_time','event_location','issue_date','payment_due_date',
  'description','conditions','late_penalties','vat_mode'
];
const invoiceMoney=cents=>(cents/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
// Les nouvelles factures prennent directement le tarif TTC. Les anciennes
// sans price_mode conservent leurs tarifs HT et leur calcul historiques.
const invoicePriceMode=()=>invoiceState.current?.data?.price_mode||(
  invoiceState.current?'ht':'ttc'
);
const invoiceEmailValid=value=>{
  const mail=String(value||'').trim();
  return mail.length<=254&&/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(mail);
};
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
  name.setAttribute('list','klosquesServiceSuggestions');
  const quantity=document.createElement('input');
  quantity.className='quote-line-qty';quantity.type='number';quantity.min='0.01';
  quantity.max='1000';quantity.step='0.01';quantity.setAttribute('aria-label','Quantité');
  quantity.value=String(qty);
  const price=document.createElement('input');
  price.className='quote-line-price';price.type='number';price.min='0';price.max='1000000';
  price.step='0.01';price.setAttribute('aria-label',invoicePriceMode()==='ttc'?'Prix unitaire TTC en euros':'Prix unitaire HT en euros');
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
  // Le formulaire n'exige plus de moyen de paiement. Les anciennes factures
  // émises conservent leur contenu et les brouillons historiques leurs mentions.
  data.payment_terms=invoiceState.current?.data?.payment_terms||'';
  data.price_mode=invoicePriceMode();
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
  const total=(data.lines||[]).reduce((s,line)=>s+Math.round(line.qty*line.price_cents),0);
  const pending=data.vat_mode==='non_precise';
  const percent=pending||data.vat_mode==='franchise'?0:Number(data.vat_mode);
  const direct=data.price_mode==='ttc';
  const ht=direct&&!pending?Math.round(total/(1+percent/100)):total;
  const vat=direct?(pending?0:total-ht):Math.round(ht*percent/100);
  return{ht,vat,ttc:direct?total:ht+vat,pending,direct};
}
function updateInvoiceTotal(){
  try{
    const t=invoiceAmounts(collectInvoice());
    $('invoiceTotals').textContent=t.direct
      ?'Total TTC : '+invoiceMoney(t.ttc)
      :t.pending?'Total HT : '+invoiceMoney(t.ht)+' · TVA et TTC : à préciser'
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
    'vat_mode','conditions'
  ];
  for(const key of fields)
    if(quote.data[key] && !(key==='vat_mode'&&quote.data[key]==='ttc_sans_ventilation'))
      invoiceForm.elements.namedItem(key).value=quote.data[key];
  // Le devis sélectionné permet un remplissage direct lorsqu'aucune
  // prestation n'a encore été saisie sur une nouvelle facture.
  if(!invoiceState.current&&quote.data.lines?.length&&
     $('invoiceLines').children.length===1&&
     !$('invoiceLines').querySelector('.quote-line-label')?.value.trim()&&
     !$('invoiceLines').querySelector('.quote-line-price')?.value){
    importInvoiceQuoteLines();
  }
  $('invoiceTaxDetails').open=Boolean(invoiceForm.elements.namedItem('issuer_tax_number').value);
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
  const vat=quote.data.vat_mode;
  const rate=vat==='franchise'||vat==='non_precise'||vat==='ttc_sans_ventilation'?0:Number(vat);
  const quoteAlreadyTTC=vat==='ttc_sans_ventilation';
  const invoiceWantsTTC=invoicePriceMode()==='ttc';
  for(const row of quote.data.lines){
    const price=invoiceWantsTTC&&!quoteAlreadyTTC?
      Math.round(row.price_cents*(1+rate/100)):row.price_cents;
    newInvoiceLine(row.label,row.qty,price);
  }
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
  // L'accès à l'API PDF est authentifié. Sur certains mobiles, une
  // navigation directe vers un nouvel onglet perd le cookie de session.
  // L'aperçu et le téléchargement passent donc par fetch() dans le Manager.
  const preview=$('previewInvoice'),download=$('printInvoice');
  preview.hidden=!invoice;
  download.hidden=!issued;
  preview.disabled=!invoice;
  download.disabled=!issued;
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
  const ttc=invoicePriceMode()==='ttc';
  $('invoicePriceTypeText').textContent=ttc?'Prix unitaire TTC':'Prix unitaire HT';
  $('invoicePricingInfo').textContent=ttc
    ?'Saisis la description à imprimer, la quantité et le prix unitaire TTC en euros.'
    :'Ancienne facture : conserve les prix unitaires HT utilisés à sa création.';
  $('invoiceTaxDetails').open=Boolean(data.issuer_tax_number);
  $('invoiceIssuerDetails').open=Boolean(invoice&&
    invoiceIssuerFields.some(key=>key!=='issuer_tax_number'&&!data[key]));
  $('invoiceAdditionalDetails').open=Boolean(invoice&&
    (data.description||data.conditions||data.event_time));
  updateInvoiceProfessionalFields();
  if(!invoice){
    for(const key of ['issuer_name','issuer_address','issuer_identifier','issuer_tax_number','issuer_contact','issuer_legal'])
      invoiceForm.elements.namedItem(key).value=
        invoiceState.issuer[key]||HAPPY_LIVE_ISSUER_DEFAULTS[key]||'';
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
  captureDocumentBaseline('factures');
  $('invoiceEditorPanel').scrollIntoView({block:'start',behavior:'smooth'});
}
function renderInvoices(){
  const showArchived=$('invoiceVisibility').value==='archived';
  const rows=invoiceState.invoices.filter(inv=>Boolean(inv.archived)===showArchived);
  $('invoiceList').innerHTML=rows.length?rows.map(inv=>{
    const safe=escapeHtml,t=invoiceAmounts(inv.data);
    const label=inv.archived?'Archivée · '+invoiceStatusLabel(inv):invoiceStatusLabel(inv);
    const category=inv.paid?'confirmed':inv.status==='emise'?'pending':'';
    const issued=inv.status==='emise';
    return '<article class="document-list-item" data-document-invoice="'+safe(inv.id)+'">'+
      '<button type="button" class="booking-card" data-invoice-id="'+safe(inv.id)+'">'+
      '<div class="card-top"><span class="date">'+safe(inv.number||'Brouillon non numéroté')+'</span>'+
      '<span class="tag '+category+'">'+safe(label)+'</span></div>'+
      '<h3>'+safe(inv.data.client_name||'Client à préciser')+'</h3>'+
      '<p>'+safe(inv.data.event_date?dateLabel(inv.data.event_date):'Date à préciser')+'</p>'+
      '<p>'+safe(t.pending&&!t.direct?'Montant TTC à préciser':'Total TTC : '+invoiceMoney(t.ttc))+'</p>'+
      (inv.sent_at?'<p class="small quote-email-sent">E-mail envoyé le '+safe(inv.sent_at)+'</p>':'')+
      '<p class="small">'+(issued?'Consulter la facture →':'Modifier le brouillon →')+'</p></button>'+
      '<div class="document-pdf-actions" aria-label="PDF de la facture '+safe(inv.number||'brouillon')+'">'+
      '<button type="button" class="secondary" data-invoice-pdf-preview="'+safe(inv.id)+'" aria-label="Visualiser le PDF de la facture '+safe(inv.number||'brouillon')+'">Visualiser le PDF</button>'+
      (issued?'<button type="button" class="secondary" data-invoice-pdf-download="'+safe(inv.id)+'" aria-label="Télécharger le PDF de la facture '+safe(inv.number||'brouillon')+'">Télécharger le PDF</button>':'')+
      '</div></article>';
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
$('saveInvoiceProfile').addEventListener('click',async()=>{
  const button=$('saveInvoiceProfile');
  if(invoiceState.current?.status==='emise')return;
  const data=Object.fromEntries(invoiceIssuerFields.map(key=>[
    key,invoiceForm.elements.namedItem(key).value.trim()
  ]));
  button.disabled=true;
  try{
    // Profil émetteur partagé avec les devis, stocké dans Cloudflare D1.
    // Mémorise aussi le n° de TVA éventuel de la rubrique fiscale.
    const result=await jsonCall('/api/admin/quotes','POST',{action:'profile',data});
    invoiceState.issuer=result.issuer;
    if(typeof officialQuoteState!=='undefined')officialQuoteState.issuer=result.issuer;
    notify('Coordonnées mémorisées pour les prochains devis et factures.');
  }catch(error){notify('Coordonnées non mémorisées : '+error.message);}
  finally{button.disabled=false;}
});
$('closeInvoice').addEventListener('click',()=>{$('invoiceEditorPanel').hidden=true;invoiceState.current=null;});
$('addInvoiceLine').addEventListener('click',()=>newInvoiceLine());
$('invoiceBooking').addEventListener('change',populateInvoiceFromBooking);
$('invoiceQuote').addEventListener('change',populateInvoiceFromQuote);
function updateInvoiceProfessionalFields(){
  $('invoiceProfessionalFields').hidden=
    invoiceForm.elements.namedItem('client_type').value!=='professionnel';
}
invoiceForm.elements.namedItem('client_type').addEventListener(
  'change',updateInvoiceProfessionalFields
);
$('importInvoiceQuote').addEventListener('click',importInvoiceQuoteLines);
invoiceForm.elements.namedItem('vat_mode').addEventListener('change',updateInvoiceTotal);
$('invoiceList').addEventListener('click',event=>{
  const pdfButton=event.target.closest('[data-invoice-pdf-preview],[data-invoice-pdf-download]');
  if(pdfButton){
    const download=pdfButton.hasAttribute('data-invoice-pdf-download');
    const id=download?pdfButton.dataset.invoicePdfDownload:pdfButton.dataset.invoicePdfPreview;
    const invoice=invoiceState.invoices.find(i=>i.id===id);
    if(invoice)showInvoicePdf(download,invoice,pdfButton);
    return;
  }
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
  if(issue&&data.vat_mode==='non_precise'){
    notify('Avant d’émettre une facture, choisis son régime de TVA dans la rubrique Dates et TVA.');
    $('invoiceVatMode').scrollIntoView({block:'center',behavior:'smooth'});
    $('invoiceVatMode').focus();
    return;
  }
  if(issue&&data.client_type==='professionnel'&&!data.late_penalties){
    $('invoiceProfessionalFields').hidden=false;
    notify('Renseigne les pénalités de retard applicables au client professionnel.');
    invoiceForm.elements.namedItem('late_penalties').focus();
    return;
  }
  if(issue&&!window.confirm(
    'Émettre définitivement cette facture ? Un numéro unique sera attribué. Elle ne pourra ensuite plus être modifiée ni supprimée. Vérifie les informations légales, les prix et la situation TVA.'
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
    // Fermer les champs après la sauvegarde et remettre en évidence
    // la carte avec les boutons PDF immédiatement accessibles.
    $('invoiceEditorPanel').hidden=true;
    invoiceState.current=null;
    $('invoiceVisibility').value='current';
    renderInvoices();
    const selected=Array.from($('invoiceList').querySelectorAll('[data-invoice-id]'))
      .find(el=>el.dataset.invoiceId===String(response.invoice.id));
    if(selected){
      selected.focus({preventScroll:true});
      selected.scrollIntoView({block:'center',behavior:'smooth'});
    }
    notify(issue?'Facture émise : visualise ou télécharge son PDF sous la facture.'
      :'Brouillon enregistré : visualise son PDF sous la facture ou rouvre-le pour le modifier.');
  }catch(error){notify(error.message);}
  finally{save.disabled=false;final.disabled=false;}
}
$('saveInvoice').addEventListener('click',()=>saveInvoice(false));
$('issueInvoice').addEventListener('click',()=>saveInvoice(true));
// Récupère le PDF depuis la session active (cookie HttpOnly transmis à fetch),
// puis ouvre uniquement un URL blob local. L'API n'est jamais exposée sans auth.
const invoicePdfPreviewUrls=new Set();
window.addEventListener('pagehide',()=>{
  for(const url of invoicePdfPreviewUrls)URL.revokeObjectURL(url);
  invoicePdfPreviewUrls.clear();
});
function downloadInvoicePdfBlob(url,filename){
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(()=>{
    URL.revokeObjectURL(url);
    invoicePdfPreviewUrls.delete(url);
  },60000);
}
async function showInvoicePdf(download=false,selectedInvoice=null,actionButton=null){
  const invoice=selectedInvoice||invoiceState.current;
  if(!invoice?.id){
    notify('Enregistre le brouillon avant de visualiser la facture.');
    return;
  }
  if(download&&invoice.status!=='emise'){
    notify('Le téléchargement est réservé aux factures émises.');
    return;
  }
  const previewButton=$('previewInvoice'),downloadButton=$('printInvoice');
  previewButton.disabled=true;downloadButton.disabled=true;
  if(actionButton)actionButton.disabled=true;
  try{
    const response=await fetch(
      '/api/admin/invoices/'+encodeURIComponent(invoice.id)+'/pdf',
      {credentials:'same-origin',cache:'no-store',headers:{Accept:'application/pdf'}}
    );
    if(!response.ok){
      if(response.status===401)throw Error('La session a expiré. Reconnecte-toi dans KLOSQUE MANAGER.');
      const message=await response.text().catch(()=>'');
      throw Error(message&&message.length<180?message:'La génération du PDF a échoué.');
    }
    if(!String(response.headers.get('Content-Type')||'').toLowerCase().includes('application/pdf'))
      throw Error('Le serveur n’a pas retourné de PDF. Reconnecte-toi puis réessaie.');
    const blob=await response.blob();
    if(!blob.size)throw Error('Le fichier PDF est vide.');
    if(download){
      const url=URL.createObjectURL(blob);
      invoicePdfPreviewUrls.add(url);
      downloadInvoicePdfBlob(url,(invoice.number||'BROUILLON-'+invoice.id.slice(0,8))+'.pdf');
    }else{
      await showManagerPdfPreview(blob,invoice.number||'Brouillon de facture','factures');
    }
  }catch(error){
    notify('PDF non ouvert : '+error.message);
  }finally{
    const current=invoiceState.current;
    previewButton.disabled=!current?.id;
    downloadButton.disabled=!current?.id||current.status!=='emise';
    if(actionButton&&actionButton.isConnected)actionButton.disabled=false;
  }
}
$('previewInvoice').addEventListener('click',()=>showInvoicePdf(false));
$('printInvoice').addEventListener('click',()=>showInvoicePdf(true));
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
let invoiceRibAvailable=false;
const invoiceSendDialog=$('sendInvoiceDialog');
function updateInvoiceSendRecipient(){
  const recipient=$('invoiceSendEmail').value.trim();
  $('invoiceSendDestination').textContent=recipient
    ?'Facture PDF destinée à : '+recipient
    :'Saisis une adresse e-mail pour envoyer la facture.';
  $('confirmSendInvoice').disabled=!invoiceState.mailReady||!invoiceRibAvailable||
    !invoiceEmailValid(recipient);
}
$('invoiceSendEmail').addEventListener('input',updateInvoiceSendRecipient);
$('sendInvoice').addEventListener('click',async()=>{
  const invoice=invoiceState.current;
  if(!invoice||invoice.status!=='emise')return;
  const linked=state.items.find(item=>item.id===invoice.booking_id);
  pendingInvoiceSend=invoice.id;
  invoiceRibAvailable=false;
  $('invoiceSendRibStatus').textContent='Vérification du RIB Happy Live 66…';
  $('invoiceSendEmail').value=invoice.data.client_email||linked?.email||'';
  $('invoiceSendMessage').value='';
  $('invoiceSendWarning').hidden=invoiceState.mailReady;
  $('invoiceSendPreviously').hidden=!invoice.sent_at;
  $('invoiceSendFeedback').textContent='';
  updateInvoiceSendRecipient();
  invoiceSendDialog.showModal();
  try{
    const data=await callApi('/api/admin/invoice-rib');
    if(pendingInvoiceSend!==invoice.id||!invoiceSendDialog.open)return;
    invoiceRibAvailable=data.configured===true;
    $('invoiceSendRibStatus').textContent=invoiceRibAvailable
      ?'Pièces jointes : la facture PDF et le RIB Happy Live 66 PDF.'
      :'RIB non configuré : le gestionnaire doit l’ajouter dans Site → RIB à joindre aux factures avant l’envoi.';
  }catch(error){
    if(pendingInvoiceSend===invoice.id&&invoiceSendDialog.open)
      $('invoiceSendRibStatus').textContent='RIB non vérifié : '+error.message;
  }finally{updateInvoiceSendRecipient();}
});
$('cancelSendInvoice').addEventListener('click',()=>invoiceSendDialog.close());
invoiceSendDialog.addEventListener('close',()=>{pendingInvoiceSend=null;invoiceRibAvailable=false;});
$('confirmSendInvoice').addEventListener('click',async()=>{
  const id=pendingInvoiceSend;if(!id||!invoiceState.mailReady||!invoiceRibAvailable)return;
  const recipient=$('invoiceSendEmail').value.trim();
  const personalMessage=$('invoiceSendMessage').value.trim();
  if(personalMessage.length>2000){
    $('invoiceSendFeedback').textContent='Le message doit contenir au maximum 2 000 caractères.';
    return;
  }
  if(!invoiceEmailValid(recipient)){updateInvoiceSendRecipient();return;}
  const btn=$('confirmSendInvoice');btn.disabled=true;
  $('invoiceSendEmail').disabled=true;
  $('invoiceSendMessage').disabled=true;
  $('invoiceSendFeedback').textContent='Envoi du PDF à '+recipient+'…';
  try{
    const response=await jsonCall('/api/admin/invoices/'+encodeURIComponent(id)+'/send',
      'POST',{confirm_send:true,recipient,personal_message:personalMessage});
    pendingInvoiceSend=null;invoiceSendDialog.close();
    await loadInvoices();await refresh();
    const updated=invoiceState.invoices.find(i=>i.id===id);
    if(updated){invoiceState.current=updated;lockInvoiceEditor();}
    notify(response.recorded
      ? 'Le service de messagerie a accepté la facture et le RIB en PDF pour '+response.recipient+'.'
      : 'Le service a accepté la facture et le RIB en PDF pour '+response.recipient+
        ', mais l’historique n’a pas pu être sauvegardé. Vérifie avant de renvoyer.');
  }catch(error){$('invoiceSendFeedback').textContent='Envoi non effectué : '+error.message;}
  finally{
    $('invoiceSendEmail').disabled=false;
    $('invoiceSendMessage').disabled=false;
    updateInvoiceSendRecipient();
  }
});
document.querySelector('[data-tab="factures"]').addEventListener('click',loadInvoices);
