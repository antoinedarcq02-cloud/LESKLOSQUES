'use strict';

// Les aperçus sont affichés dans le Manager : sur mobile, un nouvel onglet
// PDF peut s'ouvrir sans bouton de retour vers l'application.
const managerPdfDialog=document.getElementById('managerPdfPreviewDialog');
const managerPdfFrame=document.getElementById('managerPdfPreviewFrame');
const managerPdfReturn=document.getElementById('managerPdfPreviewReturn');
const managerPdfClose=document.getElementById('managerPdfPreviewClose');
let managerPdfObjectUrl=null;
let managerPdfPreviousFocus=null;

function closeManagerPdfPreview(){
  if(managerPdfDialog.open)managerPdfDialog.close();
}

function showManagerPdfPreview(url,title,kind){
  if(typeof url!=='string'||!url.startsWith('blob:'))
    throw Error('Adresse de prévisualisation invalide.');
  if(managerPdfDialog.open)closeManagerPdfPreview();
  managerPdfPreviousFocus=document.activeElement;
  managerPdfObjectUrl=url;
  document.getElementById('managerPdfPreviewTitle').textContent=title||'Aperçu PDF';
  managerPdfReturn.textContent=kind==='factures'?'← Retour aux factures':'← Retour aux devis';
  managerPdfFrame.src=url;
  managerPdfDialog.showModal();
  managerPdfReturn.focus({preventScroll:true});
}

function releaseManagerPdfPreview(){
  managerPdfFrame.removeAttribute('src');
  // L'URL n'est plus utile après fermeture de la visionneuse.
  if(managerPdfObjectUrl){
    URL.revokeObjectURL(managerPdfObjectUrl);
    managerPdfObjectUrl=null;
  }
  if(managerPdfPreviousFocus?.isConnected&&
     typeof managerPdfPreviousFocus.focus==='function')
    managerPdfPreviousFocus.focus({preventScroll:true});
  managerPdfPreviousFocus=null;
}

managerPdfReturn.addEventListener('click',closeManagerPdfPreview);
managerPdfClose.addEventListener('click',closeManagerPdfPreview);
managerPdfDialog.addEventListener('close',releaseManagerPdfPreview);
// Échap / retour matériel Android déclenchent normalement « cancel »
// sur une boîte de dialogue HTML ; le bouton reste accessible sur iPhone.
managerPdfDialog.addEventListener('cancel',()=>{});
