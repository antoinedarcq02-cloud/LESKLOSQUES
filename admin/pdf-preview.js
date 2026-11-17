'use strict';

// Le lecteur PDF natif d'Android affiche souvent un bouton « Ouvrir » dans
// les iframes au lieu de rendre le document. Rendu local de chaque page sur
// canvas avec PDF.js : l'utilisateur reste dans Klosques Manager.
// La version du moteur et du worker est fixée pour éviter tout décalage.
const MANAGER_PDF_JS_BASE='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/';
const managerPdfDialog=document.getElementById('managerPdfPreviewDialog');
const managerPdfPages=document.getElementById('managerPdfPreviewPages');
const managerPdfStatus=document.getElementById('managerPdfPreviewStatus');
const managerPdfReturn=document.getElementById('managerPdfPreviewReturn');
const managerPdfClose=document.getElementById('managerPdfPreviewClose');
const managerPdfZoomOut=document.getElementById('managerPdfZoomOut');
const managerPdfZoomIn=document.getElementById('managerPdfZoomIn');
const managerPdfZoomLabel=document.getElementById('managerPdfZoomLabel');

let managerPdfPreviousFocus=null;
let managerPdfLoadPromise=null;
let managerPdfDocument=null;
let managerPdfLoadTask=null;
let managerPdfRenderTask=null;
let managerPdfSequence=0;
let managerPdfZoom=1;

async function loadManagerPdfRenderer(){
  if(!managerPdfLoadPromise){
    managerPdfLoadPromise=import(MANAGER_PDF_JS_BASE+'pdf.min.mjs').then(pdfjs=>{
      pdfjs.GlobalWorkerOptions.workerSrc=MANAGER_PDF_JS_BASE+'pdf.worker.min.mjs';
      return pdfjs;
    }).catch(error=>{
      managerPdfLoadPromise=null;
      throw error;
    });
  }
  return managerPdfLoadPromise;
}

function closeManagerPdfPreview(){
  if(managerPdfDialog.open)managerPdfDialog.close();
}

function releaseManagerPdfPreview(){
  ++managerPdfSequence;
  if(managerPdfRenderTask){
    managerPdfRenderTask.cancel();
    managerPdfRenderTask=null;
  }
  if(managerPdfLoadTask){
    managerPdfLoadTask.destroy().catch(()=>{});
    managerPdfLoadTask=null;
  }
  if(managerPdfDocument){
    managerPdfDocument.destroy().catch(()=>{});
    managerPdfDocument=null;
  }
  managerPdfPages.replaceChildren();
  managerPdfStatus.textContent='';
  if(managerPdfPreviousFocus?.isConnected&&
    typeof managerPdfPreviousFocus.focus==='function')
    managerPdfPreviousFocus.focus({preventScroll:true});
  managerPdfPreviousFocus=null;
}

async function renderManagerPdfPages(sequence){
  if(!managerPdfDocument||sequence!==managerPdfSequence||!managerPdfDialog.open)return;
  if(managerPdfRenderTask){
    managerPdfRenderTask.cancel();
    managerPdfRenderTask=null;
  }
  managerPdfPages.replaceChildren();
  managerPdfPages.scrollTop=0;
  managerPdfZoomLabel.textContent=Math.round(managerPdfZoom*100)+' %';
  managerPdfZoomOut.disabled=managerPdfZoom<=0.75;
  managerPdfZoomIn.disabled=managerPdfZoom>=2.25;
  const pdf=managerPdfDocument;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const availableWidth=Math.max(270,(managerPdfPages.clientWidth||window.innerWidth)-24);
  try{
    for(let i=1;i<=pdf.numPages;i++){
      if(sequence!==managerPdfSequence||!managerPdfDialog.open)return;
      managerPdfStatus.textContent='Affichage de la page '+i+' sur '+pdf.numPages+'…';
      const page=await pdf.getPage(i);
      if(sequence!==managerPdfSequence||!managerPdfDialog.open)return;
      const original=page.getViewport({scale:1});
      const scale=(availableWidth/original.width)*managerPdfZoom;
      const viewport=page.getViewport({scale:scale*dpr});
      const canvas=document.createElement('canvas');
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw Error('Affichage graphique indisponible.');
      canvas.width=Math.ceil(viewport.width);
      canvas.height=Math.ceil(viewport.height);
      canvas.style.width=(viewport.width/dpr)+'px';
      canvas.style.height=(viewport.height/dpr)+'px';
      canvas.className='manager-pdf-page';
      canvas.setAttribute('aria-label','Page '+i+' sur '+pdf.numPages);
      managerPdfPages.append(canvas);
      const task=page.render({canvasContext:context,viewport,background:'#ffffff'});
      managerPdfRenderTask=task;
      await task.promise;
      if(managerPdfRenderTask===task)managerPdfRenderTask=null;
      page.cleanup();
    }
    if(sequence===managerPdfSequence){
      managerPdfStatus.textContent=pdf.numPages>1
        ?pdf.numPages+' pages affichées. Fais défiler pour les lire.'
        :'Document affiché. Utilise « Retour » pour revenir à la liste.';
    }
  }catch(error){
    if(sequence!==managerPdfSequence||!managerPdfDialog.open)return;
    if(error?.name==='RenderingCancelledException')return;
    managerPdfStatus.textContent='Impossible d’afficher les pages du PDF. Ferme cet aperçu et réessaie.';
    console.warn('Aperçu PDF non rendu',error?.message);
  }
}

async function showManagerPdfPreview(blob,title,kind){
  if(!(blob instanceof Blob)||!blob.size)throw Error('PDF vide ou incorrect.');
  if(managerPdfDialog.open)closeManagerPdfPreview();
  const sequence=++managerPdfSequence;
  managerPdfPreviousFocus=document.activeElement;
  managerPdfZoom=1;
  managerPdfZoomLabel.textContent='100 %';
  managerPdfPages.replaceChildren();
  managerPdfStatus.textContent='Préparation du PDF…';
  document.getElementById('managerPdfPreviewTitle').textContent=title||'Aperçu PDF';
  managerPdfReturn.textContent=kind==='factures'?'← Retour aux factures':'← Retour aux devis';
  managerPdfDialog.showModal();
  managerPdfReturn.focus({preventScroll:true});
  try{
    const pdfjs=await loadManagerPdfRenderer();
    if(sequence!==managerPdfSequence||!managerPdfDialog.open)return;
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(sequence!==managerPdfSequence||!managerPdfDialog.open)return;
    const loading=pdfjs.getDocument({data:bytes,isEvalSupported:false});
    managerPdfLoadTask=loading;
    const doc=await loading.promise;
    if(sequence!==managerPdfSequence||!managerPdfDialog.open){
      doc.destroy().catch(()=>{});
      return;
    }
    managerPdfLoadTask=null;
    managerPdfDocument=doc;
    await renderManagerPdfPages(sequence);
  }catch(error){
    if(sequence!==managerPdfSequence||!managerPdfDialog.open)return;
    managerPdfStatus.textContent='Impossible de charger l’aperçu. Vérifie la connexion et réessaie.';
    console.warn('Lecteur PDF non disponible',error?.message);
  }
}

function changeManagerPdfZoom(direction){
  if(!managerPdfDocument)return;
  const next=Math.min(2.25,Math.max(0.75,managerPdfZoom+direction*0.25));
  if(next===managerPdfZoom)return;
  managerPdfZoom=next;
  ++managerPdfSequence;
  renderManagerPdfPages(managerPdfSequence);
}

managerPdfReturn.addEventListener('click',closeManagerPdfPreview);
managerPdfClose.addEventListener('click',closeManagerPdfPreview);
managerPdfZoomOut.addEventListener('click',()=>changeManagerPdfZoom(-1));
managerPdfZoomIn.addEventListener('click',()=>changeManagerPdfZoom(1));
managerPdfDialog.addEventListener('close',releaseManagerPdfPreview);
