'use strict';

// Le RIB n'est jamais stocké dans le navigateur ni dans le dépôt public.
// Le fichier PDF est envoyé à une API authentifiée, puis conservé dans D1.
const ribFile=$('invoiceRibFile');
const ribUpload=$('uploadInvoiceRib');
const ribDownload=$('downloadInvoiceRib');
const ribDelete=$('deleteInvoiceRib');
const ribStatus=$('invoiceRibStatus');
const RIB_MAX_BYTES=1350000;

async function loadInvoiceRibStatus(){
  if(!state.logged||state.role!=='admin')return;
  ribStatus.textContent='Vérification du RIB enregistré…';
  try{
    const data=await callApi('/api/admin/invoice-rib');
    ribDownload.hidden=!data.configured;
    ribDelete.hidden=!data.configured;
    ribStatus.textContent=data.configured
      ?'RIB enregistré : '+data.filename+' ('+Math.round(data.size_bytes/1024)+' Ko). Il sera joint automatiquement aux devis et factures envoyés.'
      :'Aucun RIB enregistré. Ajoute le PDF avant d’envoyer un devis ou une facture par e-mail.';
  }catch(error){
    ribStatus.textContent='Impossible de vérifier le RIB : '+error.message;
  }
}

ribUpload.addEventListener('click',async()=>{
  if(state.role!=='admin')return;
  const file=ribFile.files?.[0];
  if(!file){ribStatus.textContent='Choisis le PDF du RIB Happy Live 66.';return;}
  if(file.size<100||file.size>RIB_MAX_BYTES){
    ribStatus.textContent='Le PDF doit peser au maximum 1,35 Mo.';
    return;
  }
  if(!file.name.toLowerCase().endsWith('.pdf')){
    ribStatus.textContent='Choisis un fichier PDF.';
    return;
  }
  ribUpload.disabled=true;
  ribStatus.textContent='Enregistrement sécurisé du RIB…';
  try{
    await callApi('/api/admin/invoice-rib',{
      method:'POST',headers:{'Content-Type':'application/pdf'},body:file
    });
    ribFile.value='';
    await loadInvoiceRibStatus();
    notify('RIB Happy Live 66 enregistré pour l’envoi automatique avec les devis et factures.');
  }catch(error){ribStatus.textContent='Enregistrement impossible : '+error.message;}
  finally{ribUpload.disabled=false;}
});

ribDownload.addEventListener('click',()=>{
  if(state.role!=='admin')return;
  // Le téléchargement reste derrière l'authentification du Manager.
  window.open('/api/admin/invoice-rib?download=1','_blank','noopener');
});
ribDelete.addEventListener('click',async()=>{
  if(state.role!=='admin')return;
  if(!window.confirm('Retirer le RIB ? Les devis et factures ne pourront plus être envoyés avec le RIB tant qu’un nouveau PDF n’aura pas été enregistré.'))return;
  ribDelete.disabled=true;
  try{
    await jsonCall('/api/admin/invoice-rib','DELETE',{confirm:true});
    ribStatus.textContent='RIB retiré.';
    await loadInvoiceRibStatus();
    notify('RIB retiré des futurs devis et factures.');
  }catch(error){ribStatus.textContent='Suppression impossible : '+error.message;}
  finally{ribDelete.disabled=false;}
});
document.querySelectorAll('[data-tab="site"]').forEach(button=>
  button.addEventListener('click',loadInvoiceRibStatus)
);
