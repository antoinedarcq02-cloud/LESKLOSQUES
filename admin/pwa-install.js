'use strict';
// Installation propre au Manager, sans modifier le site public.
(()=>{
  const dialog=document.getElementById('installManagerHelp');
  const close=document.getElementById('closeInstallManagerHelp');
  const launchers=[...document.querySelectorAll('[data-install-manager]')];
  const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||
    window.navigator.standalone===true;
  const update=()=>{for(const btn of launchers)btn.closest('.install-manager-entry').hidden=standalone();};
  let pendingInstall=null;
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    pendingInstall=event;
    update();
  });
  window.addEventListener('appinstalled',()=>{
    pendingInstall=null;
    dialog.close();
    update();
  });
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change',update);
  for(const btn of launchers)btn.addEventListener('click',async()=>{
    if(standalone()){update();return;}
    if(pendingInstall){
      const prompt=pendingInstall;
      pendingInstall=null;
      try{
        await prompt.prompt();
        await prompt.userChoice;
      }catch{
        dialog.showModal();
      }
      update();
      return;
    }
    const ios=/iPad|iPhone|iPod/.test(navigator.userAgent);
    document.getElementById('installManagerSteps').textContent=ios
      ?'Sur iPhone : ouvre cette page dans Safari, touche Partager, puis « Sur l’écran d’accueil » et confirme.'
      :'Sur Android : ouvre cette page dans Chrome, touche le menu ⋮, puis « Ajouter à l’écran d’accueil » ou « Installer l’application ».';
    dialog.showModal();
  });
  close.addEventListener('click',()=>dialog.close());
  update();
  if('serviceWorker' in navigator&&window.isSecureContext){
    navigator.serviceWorker.register('/admin/sw.js',{scope:'/admin/'})
      .catch(()=>{/* Le site reste fonctionnel, même sans service worker. */});
  }
})();
