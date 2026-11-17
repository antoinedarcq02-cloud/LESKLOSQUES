'use strict';

// Une fiche client conduit directement à ses documents sans créer ni envoyer
// quoi que ce soit automatiquement. Les données viennent des API authentifiées.
let bookingRelatedRequest=0;
function bookingEditorSnapshot(){
  const data=Object.fromEntries(quoteKeys.map(key=>[key,editor.elements.namedItem(key).value]));
  data.quote_euros=editor.elements.namedItem('quote_euros').value;
  return JSON.stringify(data);
}
let bookingOriginalSnapshot='';
function bookingChangesAllowed(){
  if(bookingEditorSnapshot()===bookingOriginalSnapshot)return true;
  return window.confirm('Cette fiche comporte des modifications non enregistrées. Quitter sans les enregistrer ?');
}
function bookingRelatedDocumentButton(label,type,id){
  const button=document.createElement('button');
  button.type='button';button.className='secondary';
  button.textContent=label;
  button.addEventListener('click',async()=>{
    if(!bookingChangesAllowed())return;
    bookingDialog.close();
    try{
      if(type==='devis'){
        setPage('devis');
        await loadOfficialQuotes();
        const found=officialQuoteState.quotes.find(q=>String(q.id)===String(id));
        if(found)fillQuoteForm(found);
        else notify('Ce devis ne figure plus dans les documents.');
      }else{
        setPage('factures');
        await loadInvoices();
        const found=invoiceState.invoices.find(inv=>inv.id===id);
        if(found){
          $('invoiceVisibility').value=found.archived?'archived':'current';
          renderInvoices();
          fillInvoice(found);
        }else notify('Cette facture ne figure plus dans les documents.');
      }
    }catch(error){notify('Ouverture du document impossible : '+error.message);}
  });
  return button;
}
async function updateBookingActions(item){
  const box=$('bookingRelatedActions');
  box.hidden=!item;
  const seq=++bookingRelatedRequest;
  if(!item){$('bookingRelatedDocuments').replaceChildren();return;}
  bookingOriginalSnapshot=bookingEditorSnapshot();
  const root=$('bookingRelatedDocuments');
  root.textContent='Chargement des documents associés…';
  try{
    const [q,i]=await Promise.all([callApi('/api/admin/quotes'),callApi('/api/admin/invoices')]);
    if(seq!==bookingRelatedRequest||state.current?.id!==item.id||!bookingDialog.open)return;
    const quotes=(q.quotes||[]).filter(doc=>doc.booking_id===item.id);
    const quoteIds=new Set(quotes.map(doc=>String(doc.id)));
    const invoices=(i.invoices||[]).filter(doc=>
      doc.booking_id===item.id||(!doc.booking_id&&doc.quote_id&&quoteIds.has(String(doc.quote_id))));
    root.replaceChildren();
    if(!quotes.length&&!invoices.length){
      const empty=document.createElement('p');empty.className='muted small';
      empty.textContent='Aucun devis ou facture associé à ce dossier pour le moment.';
      root.append(empty);return;
    }
    for(const quote of quotes){
      root.append(bookingRelatedDocumentButton(
        'Devis '+(quote.number||'brouillon')+' · '+(quote.sent_at?'Envoyé':quote.status==='finalise'?'À envoyer':'Brouillon')+' →',
        'devis',quote.id));
    }
    for(const invoice of invoices){
      root.append(bookingRelatedDocumentButton(
        'Facture '+(invoice.number||'brouillon')+' · '+(invoice.paid?'Payée':invoice.sent_at?'Envoyée':invoice.status==='emise'?'À envoyer':'Brouillon')+' →',
        'facture',invoice.id));
    }
  }catch(error){
    if(seq===bookingRelatedRequest&&state.current?.id===item.id)
      root.textContent='Documents temporairement indisponibles. Les boutons de création restent utilisables.';
  }
}
$('bookingStartQuote').addEventListener('click',async()=>{
  const item=state.current;
  if(!item||!bookingChangesAllowed())return;
  bookingDialog.close();
  try{
    setPage('devis');
    await loadOfficialQuotes();
    fillQuoteForm();
    $('quoteBooking').value=item.id;
    fillFromBooking();
  }catch(error){notify('Impossible de préparer le devis : '+error.message);}
});
$('bookingStartInvoice').addEventListener('click',async()=>{
  const item=state.current;
  if(!item||!bookingChangesAllowed())return;
  bookingDialog.close();
  try{
    setPage('factures');
    await loadInvoices();
    fillInvoice();
    $('invoiceBooking').value=item.id;
    populateInvoiceFromBooking();
  }catch(error){notify('Impossible de préparer la facture : '+error.message);}
});
bookingDialog.addEventListener('close',()=>{bookingRelatedRequest++;});
