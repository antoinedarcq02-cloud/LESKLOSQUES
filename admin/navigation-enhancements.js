'use strict';

// Recherche transversale réservée aux musiciens connectés : aucune donnée
// personnelle n'est mise dans l'URL, le stockage local ou un moteur externe.
(()=>{
  const input=$('managerSearchInput');
  const results=$('managerSearchResults');
  const moreToggle=$('managerMoreToggle');
  const moreMenu=$('managerMoreMenu');
  const normalise=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('fr-FR').trim();
  let documents={quotes:[],invoices:[]};
  let searchVersion=0;
  let loading=false;
  const closeSearch=()=>{results.hidden=true;results.replaceChildren();};
  const entries=()=>{
    const bookings=state.items.map(item=>({
      type:'dossier',id:item.id,title:item.name||'Concert',
      info:[item.location,item.event_date,item.email,item.status,item.package].filter(Boolean).join(' · '),
      tokens:[item.name,item.location,item.event_date,item.email,item.phone,item.package,item.status].join(' '),
      value:item
    }));
    const quotes=documents.quotes.map(q=>({
      type:'devis',id:q.id,title:q.data?.client_name||'Client',
      info:[q.number,q.data?.event_date,q.data?.event_location,q.status].filter(Boolean).join(' · '),
      tokens:[q.number,q.data?.client_name,q.data?.client_email,q.data?.event_date,q.data?.event_location].join(' ')
    }));
    const invoices=documents.invoices.map(inv=>({
      type:'facture',id:inv.id,title:inv.data?.client_name||'Client',
      info:[inv.number||'Brouillon',inv.data?.event_date,inv.data?.event_location,inv.paid?'Payée':inv.status].filter(Boolean).join(' · '),
      tokens:[inv.number,inv.data?.client_name,inv.data?.client_email,inv.data?.event_date,inv.data?.event_location].join(' ')
    }));
    return [...bookings,...quotes,...invoices];
  };
  function renderSearch(){
    results.replaceChildren();
    const query=normalise(input.value);
    if(!state.logged||!query){closeSearch();return;}
    const words=query.split(/\s+/).filter(Boolean);
    const found=entries().filter(entry=>{
      const tokens=normalise(entry.tokens);
      return words.every(word=>tokens.includes(word));
    }).slice(0,15);
    results.hidden=false;
    const header=document.createElement('p');
    header.className='manager-search-count';
    header.textContent=found.length?found.length+' résultat(s) affiché(s)'+(loading?' · Recherche des documents…':'')
      :(loading?'Recherche des devis et factures…':'Aucun résultat. Essaie un autre nom, numéro ou lieu.');
    results.append(header);
    for(const entry of found){
      const button=document.createElement('button');
      button.type='button';button.className='manager-search-result';
      const kind=document.createElement('strong');
      kind.textContent=(entry.type==='dossier'?'Dossier':entry.type==='devis'?'Devis':'Facture')+' · '+entry.title;
      const info=document.createElement('span');
      info.textContent=entry.info;
      button.append(kind,info);
      button.addEventListener('click',()=>openSearchEntry(entry));
      results.append(button);
    }
  }
  async function loadSearchDocuments(){
    if(!state.logged)return;
    const version=++searchVersion;
    loading=true;renderSearch();
    try{
      const [quotes,invoices]=await Promise.all([
        callApi('/api/admin/quotes'),callApi('/api/admin/invoices')
      ]);
      if(version!==searchVersion||!state.logged)return;
      documents={quotes:quotes.quotes||[],invoices:invoices.invoices||[]};
    }catch(error){
      if(version===searchVersion)notify('Recherche des documents indisponible : '+error.message);
    }finally{
      if(version===searchVersion){loading=false;renderSearch();}
    }
  }
  async function openSearchEntry(entry){
    closeSearch();input.value='';
    try{
      if(entry.type==='dossier'){
        const item=state.items.find(x=>x.id===entry.id);
        if(!item){notify('Ce dossier n’est plus accessible.');return;}
        if(item.source==='site'&&!['option','confirme','termine'].includes(item.status)){
          $('requestFilter').value='all';setPage('demandes');
        }else{
          const month=String(item.event_date||'').slice(0,7);
          if(/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){
            $('agendaMonth').value=month;
            state.selectedDay=item.event_date;
          }
          setPage('agenda');
          loadGoogleCalendar();
        }
        openEditor(item);
      }else if(entry.type==='devis'){
        setPage('devis');
        await loadOfficialQuotes();
        const quote=officialQuoteState.quotes.find(x=>String(x.id)===String(entry.id));
        if(quote)fillQuoteForm(quote);
        else notify('Devis introuvable ou supprimé.');
      }else{
        $('invoiceVisibility').value='current';setPage('factures');
        await loadInvoices();
        const invoice=invoiceState.invoices.find(x=>x.id===entry.id);
        if(invoice){
          if(invoice.archived){$('invoiceVisibility').value='archived';renderInvoices();}
          fillInvoice(invoice);
        }else notify('Facture introuvable ou supprimée.');
      }
    }catch(error){notify('Impossible d’ouvrir le document : '+error.message);}
  }
  input.addEventListener('focus',()=>{if(state.logged)loadSearchDocuments();});
  input.addEventListener('input',renderSearch);
  input.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closeSearch();input.blur();}
    if(event.key==='Enter'&&!results.hidden){
      const first=results.querySelector('.manager-search-result');
      if(first){event.preventDefault();first.click();}
    }
  });
  const closeMore=()=>{moreMenu.hidden=true;moreToggle.setAttribute('aria-expanded','false');};
  moreToggle.addEventListener('click',()=>{
    const shouldOpen=moreMenu.hidden;
    moreMenu.hidden=!shouldOpen;
    moreToggle.setAttribute('aria-expanded',String(shouldOpen));
    if(shouldOpen)closeSearch();
  });
  moreMenu.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',closeMore));
  document.querySelectorAll('.bottom-nav > [data-tab]').forEach(button=>button.addEventListener('click',closeMore));
  document.addEventListener('click',event=>{
    if(!event.target.closest('.manager-quick-search'))closeSearch();
    if(!event.target.closest('.bottom-nav'))closeMore();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closeMore();closeSearch();}
  });
})();
