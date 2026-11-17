'use strict';

// Protection anti-perte des saisies pour les devis et les factures.
// Aucune donnée client n'est conservée dans localStorage ou dans un cookie.
const documentDraftBaselines={devis:null,factures:null};
function documentForm(kind){return kind==='devis'?$('officialQuoteForm'):$('invoiceForm');}
function documentPanel(kind){return kind==='devis'?$('quoteFormPanel'):$('invoiceEditorPanel');}
function documentDraftStatus(kind){return kind==='devis'?$('quoteDraftStatus'):$('invoiceDraftStatus');}
function documentFormSnapshot(kind){
  const form=documentForm(kind);
  const fields=[...form.querySelectorAll('input,textarea,select')].map(el=>[
    el.name||el.id||el.className,el.value,el.type==='checkbox'?el.checked:null
  ]);
  fields.push(['booking',$(kind==='devis'?'quoteBooking':'invoiceBooking').value]);
  if(kind==='factures')fields.push(['quote',$('invoiceQuote').value]);
  return JSON.stringify(fields);
}
function captureDocumentBaseline(kind){
  documentDraftBaselines[kind]=documentFormSnapshot(kind);
  updateDocumentDraftStatus(kind);
}
function documentHasUnsavedChanges(kind){
  if(documentPanel(kind).hidden||documentDraftBaselines[kind]===null)return false;
  const current=kind==='devis'?officialQuoteState.current:invoiceState.current;
  if(kind==='devis'&&current?.status==='finalise')return false;
  if(kind==='factures'&&current?.status==='emise')return false;
  return documentFormSnapshot(kind)!==documentDraftBaselines[kind];
}
function updateDocumentDraftStatus(kind){
  const box=documentDraftStatus(kind);
  if(documentPanel(kind).hidden){box.hidden=true;return;}
  const dirty=documentHasUnsavedChanges(kind);
  const current=kind==='devis'?officialQuoteState.current:invoiceState.current;
  box.hidden=!dirty&&!current;
  box.textContent=dirty?'● Modifications non enregistrées — clique sur « Enregistrer le brouillon ».'
    :current?'Document enregistré.':'';
  box.classList.toggle('has-unsaved',dirty);
}
function guardDocumentExit(kind){
  if(!documentHasUnsavedChanges(kind))return true;
  return window.confirm('Tu as des modifications non enregistrées dans '+(kind==='devis'?'ce devis':'cette facture')+
    '. Quitter sans enregistrer ?');
}
for(const kind of ['devis','factures']){
  const form=documentForm(kind);
  form.addEventListener('input',()=>updateDocumentDraftStatus(kind));
  form.addEventListener('change',()=>updateDocumentDraftStatus(kind));
  // Les lignes de prestations créées ou supprimées doivent aussi être suivies.
  form.addEventListener('click',event=>{
    if(event.target.closest('.quote-line-remove')){
      window.setTimeout(()=>updateDocumentDraftStatus(kind),0);
    }
  });
}
document.addEventListener('click',event=>{
  const clicked=event.target.closest(
    '[data-tab],#closeQuote,#closeInvoice,#newQuote,#newInvoice,[data-quote-id],[data-invoice-id],#logoutBtn,.manager-search-result'
  );
  if(!clicked)return;
  const selectedTab=clicked.dataset?.tab;
  if(selectedTab&&selectedTab===state.page)return;
  const kind=state.page==='devis'?'devis':state.page==='factures'?'factures':null;
  if(!kind||!guardDocumentExit(kind)){
    if(kind){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
    return;
  }
  // La confirmation ferme l'ancien formulaire pour ne pas afficher ensuite
  // un brouillon abandonné comme s'il avait été sauvegardé.
  documentPanel(kind).hidden=true;
  if(kind==='devis')officialQuoteState.current=null;
  else invoiceState.current=null;
},true);
window.addEventListener('beforeunload',event=>{
  if(documentHasUnsavedChanges('devis')||documentHasUnsavedChanges('factures')){
    event.preventDefault();
    event.returnValue='';
  }
});
