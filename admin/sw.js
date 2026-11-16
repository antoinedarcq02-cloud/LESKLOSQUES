/* KLOSQUE MANAGER : installation autonome, mais aucun cache des données privées. */
/* Les demandes, factures, e-mails et sessions restent gérés par le serveur. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  // Les pages de l'administration sont toujours demandées en ligne.
  // Aucune réponse de l'API /api/admin ne doit être mise en cache.
  if(event.request.mode==='navigate'&&url.pathname.startsWith('/admin/')){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
  }
});
