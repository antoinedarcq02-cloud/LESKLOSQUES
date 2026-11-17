'use strict';

// Le lecteur PDF natif d'Android affiche souvent un bouton « Ouvrir » dans
// les iframes au lieu de rendre le document. Rendu local de chaque page sur
// canvas avec PDF.js : l'utilisateur reste dans Klosques Manager.
// La version du moteur et du worker est fixée pour éviter tout décalage.
const MANAGER_PDF_SOURCES=[
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/'
];
const managerPdfDialog=document.getElementById('managerPdfPreviewDialog');
const managerPdfPages=document.getElementById('managerPdfPreviewPages');
const managerPdfStatus=document.getElementById('managerPdfPreviewStatus');
const managerPdfReturn=document.getElementById('managerPdfPreviewReturn');
const managerPdfClose=document.getElementById('managerPdfPreviewClose');
const managerPdfZoomOut=document.getElementById('managerPdfZoomOut');
const managerPdfZoomIn=document.getElementById('managerPdfZoomIn');
const managerPdfZoomLabel=document.getElementById('managerPdfZoomLabel');
const managerPdfRetry=document.getElementById('managerPdfRetry');

let managerPdfPreviousFocus=null;
let managerPdfBlob=null;
let managerPdfPreferredSource=0;
let managerPdfDocument=null;
let managerPdfLoadTask=null;
let managerPdfRenderTask=null;
let managerPdfSequence=0;
let managerPdfZoom=1;

// Deux hébergeurs publics indépendants : une coupure d'un CDN ne bloque
// plus systématiquement l'aperçu. Les octets du PDF ne quittent pas le navigateur.
async function loadManagerPdfDocument(buffer,sequence){
  let lastError=null;
  for(let attempt=0;attempt<MANAGER_PDF_SOURCES.length;attempt++){
    if(sequence!==managerPdfSequence||!managerPdfDialog.open)return null;
    const index=(managerPdfPreferredSource+attempt)%MANAGER_PDF_SOURCES.length;
    const base=MANAGER_PDF_SOURCES[index];
    managerPdfStatus.textContent=attempt
      ?'Nouvel essai avec le lecteur de secours…'
      :'Chargement du lecteur PDF…';
    try{
      const pdfjs=await import(base+'pdf.min.mjs');
      if(sequence!==managerPdfSequence||!managerPdfDialog.open)return null;
      pdfjs.GlobalWorkerOptions.workerSrc=base+'pdf.worker.min.mjs';
      // Recréer le tableau de données en cas de nouvel essai : PDF.js en
      // transfère la propriété à son worker et peut détacher son buffer.
      const loading=pdfjs.getDocument({
        data:new Uint8Array(buffer.slice(0)),isEvalSupported:false
      });
      managerPdfLoadTask=loading;
      const doc=await loading.promise;
      if(sequence!==managerPdfSequence||!managerPdfDialog.open){
        await doc.destroy().catch(()=>{});
        return null;
      }
      managerPdfLoadTask=null;
      managerPdfPreferredSource=index;
      return doc;
    }catch(error){
      lastError=error;
      if(managerPdfLoadTask){
        await managerPdfLoadTask.destroy().catch(()=>{});
        managerPdfLoadTask=null;
      }
    }
  }
  throw lastError||Error('Lecteur PDF indisponible.');
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
  managerPdfBlob=null;
  managerPdfRetry.hidden=true;
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
  const dpr=Math.min(window.devicePixelRatio||1,1.5);
  const availableWidth=Math.max(270,(managerPdfPages.clientWidth||window.innerWidth)-24);
  try{
    for(let i=1;i<=pdf.numPages;i++){
      if(sequence!==managerPdfSequence||!managerPdfDialog.open)return;
      managerPdfStatus.textContent='Affichage de la page '+i+' sur '+pdf.numPages+'…';
      const page=await pdf.getPage(i);
      if(sequence!==managerPdfSequence||!managerPdfDialog.open)return;
      const original=page.getViewport({scale:1});
      const scale=(availableWidth/original.width)*managerPdfZoom;
      const full=page.getViewport({scale:scale*dpr});
      // Limiter la mémoire des canvas, notamment sur les mobiles anciens.
      const quality=Math.min(1,Math.sqrt(4500000/(full.width*full.height)));
      const viewport=page.getViewport({scale:scale*dpr*quality});
      const canvas=document.createElement('canvas');
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw Error('Affichage graphique indisponible.');
      canvas.width=Math.ceil(viewport.width);
      canvas.height=Math.ceil(viewport.height);
      canvas.style.width=(full.width/dpr)+'px';
      canvas.style.height=(full.height/dpr)+'px';
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

async function startManagerPdfLoading(sequence){
  try{
    const blob=managerPdfBlob;
    if(!blob||sequence!==managerPdfSequence||!managerPdfDialog.open)return;
    managerPdfRetry.hidden=true;
    const bytes=await blob.arrayBuffer();
    if(sequence!==managerPdfSequence||!managerPdfDialog.open)return;
    const doc=await loadManagerPdfDocument(bytes,sequence);
    if(!doc||sequence!==managerPdfSequence||!managerPdfDialog.open)return;
    managerPdfDocument=doc;
    await renderManagerPdfPages(sequence);
  }catch(error){
    if(sequence!==managerPdfSequence||!managerPdfDialog.open)return;
    managerPdfStatus.textContent='Le lecteur PDF ne répond pas. Vérifie la connexion puis réessaie.';
    managerPdfRetry.hidden=false;
    console.warn('Lecteur PDF indisponible',error?.message);
  }
}

async function showManagerPdfPreview(blob,title,kind){
  if(!(blob instanceof Blob)||!blob.size)throw Error('PDF vide ou incorrect.');
  if(managerPdfDialog.open)closeManagerPdfPreview();
  const sequence=++managerPdfSequence;
  managerPdfPreviousFocus=document.activeElement;
  managerPdfBlob=blob;
  managerPdfZoom=1;
  managerPdfZoomLabel.textContent='100 %';
  managerPdfPages.replaceChildren();
  managerPdfRetry.hidden=true;
  managerPdfStatus.textContent='Préparation du PDF…';
  document.getElementById('managerPdfPreviewTitle').textContent=title||'Aperçu PDF';
  managerPdfReturn.textContent=kind==='factures'?'← Retour aux factures':'← Retour aux devis';
  managerPdfDialog.showModal();
  managerPdfReturn.focus({preventScroll:true});
  await startManagerPdfLoading(sequence);
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
managerPdfRetry.addEventListener('click',()=>{
  if(!managerPdfDialog.open||!managerPdfBlob)return;
  ++managerPdfSequence;
  startManagerPdfLoading(managerPdfSequence);
});
managerPdfDialog.addEventListener('close',releaseManagerPdfPreview);
