'use strict';

// Archive manuelle, réservée au gestionnaire. Jamais enregistrée dans
// localStorage, ni envoyée à un tiers par le navigateur.
$('exportManagerArchive').addEventListener('click',async()=>{
  if(!state.logged||state.role!=='admin')return;
  if(!window.confirm(
    'Exporter une archive contenant des informations personnelles de clients ? '+
    'Conserve le fichier téléchargé dans un espace privé et protégé.'
  ))return;
  const button=$('exportManagerArchive');
  const status=$('exportManagerStatus');
  button.disabled=true;
  status.textContent='Préparation de l’archive administrative…';
  let url=null;
  try{
    const response=await fetch('/api/admin/data-export',{
      credentials:'same-origin',cache:'no-store',
      headers:{Accept:'application/json'}
    });
    if(!response.ok){
      const data=await response.json().catch(()=>({}));
      throw Error(data.error||'Export indisponible.');
    }
    const contentType=response.headers.get('Content-Type')||'';
    if(!contentType.includes('application/json'))
      throw Error('Format de l’archive incorrect.');
    const file=await response.blob();
    if(!file.size)throw Error('L’archive reçue est vide.');
    const date=new Date().toISOString().slice(0,10);
    const link=document.createElement('a');
    url=URL.createObjectURL(file);
    link.href=url;
    link.download='klosques-archive-'+date+'.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    status.textContent='Archive préparée. Vérifie le téléchargement et garde le fichier dans un espace sécurisé. Le RIB et les secrets ne sont pas inclus.';
  }catch(error){
    status.textContent='Impossible d’exporter les données : '+error.message;
  }finally{
    button.disabled=false;
    if(url)window.setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
});
