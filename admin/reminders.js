'use strict';

// Rappels locaux : aucun envoi automatique au client.
// Les données viennent des API déjà protégées du Klosques Manager.
let currentReminders=[];
let reminderRequestVersion=0;
function reminderTimestamp(raw){
  if(typeof raw!=='string')return NaN;
  const value=raw.trim();
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))
    return Date.parse(value.replace(' ','T')+'Z');
  if(/^\d{4}-\d{2}-\d{2}T/.test(value))return Date.parse(value);
  return NaN;
}
function reminderParisDate(now){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now);
  const p=Object.fromEntries(parts.map(item=>[item.type,item.value]));
  return p.year+'-'+p.month+'-'+p.day;
}
function computeManagerReminders(bookings,quotes,invoices,now=new Date()){
  const today=reminderParisDate(now);
  const nowMs=now.getTime();
  const allowedBookings=new Map(bookings.map(b=>[b.id,b]));
  const reminders=[];
  for(const booking of bookings){
    if(booking.source!=='site'||!['nouveau','en_discussion'].includes(booking.status))continue;
    if(booking.event_date<today)continue;
    const updatedAt=reminderTimestamp(booking.updated_at||booking.created_at);
    if(!Number.isFinite(updatedAt)||nowMs-updatedAt<48*3600000)continue;
    const days=Math.floor((nowMs-updatedAt)/86400000);
    reminders.push({
      key:'request:'+booking.id,type:'request',id:booking.id,
      label:'Demande sans réponse',name:booking.name||'Organisateur',
      detail:'À recontacter · '+days+' jour'+(days>1?'s':'')+' sans mise à jour',
      order:0,stamp:updatedAt
    });
  }
  for(const quote of quotes){
    if(quote.status!=='finalise'||!quote.booking_id||!quote.sent_at)continue;
    const booking=allowedBookings.get(quote.booking_id);
    // Pas de relance si le concert est confirmé, refusé, ou en autre statut.
    if(!booking||booking.status!=='devis_envoye'||booking.event_date<today)continue;
    const sentAt=reminderTimestamp(quote.sent_at);
    if(!Number.isFinite(sentAt)||nowMs-sentAt<7*86400000)continue;
    const days=Math.floor((nowMs-sentAt)/86400000);
    reminders.push({
      key:'quote:'+quote.id,type:'quote',id:String(quote.id),
      label:'Devis envoyé sans réponse',name:quote.data?.client_name||booking.name||'Client',
      detail:(quote.number||'Devis')+' · envoyé il y a '+days+' jours',
      order:1,stamp:sentAt
    });
  }
  for(const invoice of invoices){
    // Ne pas considérer comme envoyée une facture simplement émise.
    if(invoice.status!=='emise'||invoice.paid||invoice.archived||!invoice.sent_at)continue;
    const due=invoice.data?.payment_due_date||'';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(due)||due>=today)continue;
    const late=Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(due+'T12:00:00Z'))/86400000);
    if(!Number.isFinite(late)||late<1)continue;
    reminders.push({
      key:'invoice:'+invoice.id,type:'invoice',id:String(invoice.id),
      label:'Facture en retard de paiement',name:invoice.data?.client_name||'Client',
      detail:(invoice.number||'Facture')+' · échéance dépassée de '+late+' jour'+(late>1?'s':''),
      order:2,stamp:Date.parse(due+'T12:00:00Z')
    });
  }
  return reminders.sort((a,b)=>a.order-b.order||a.stamp-b.stamp).slice(0,30);
}
function renderManagerReminders(reminders){
  const root=$('remindersList');
  root.replaceChildren();
  $('remindersCount').textContent=String(reminders.length);
  if(!reminders.length){
    const p=document.createElement('p');
    p.className='muted small';
    p.textContent='Aucun rappel à traiter pour le moment. 🎸';
    root.appendChild(p);return;
  }
  for(const reminder of reminders){
    const button=document.createElement('button');
    button.type='button';
    button.className='booking-card manager-reminder-card';
    button.dataset.reminderKey=reminder.key;
    const heading=document.createElement('strong');
    heading.textContent=reminder.label;
    const client=document.createElement('span');
    client.textContent=reminder.name;
    const detail=document.createElement('span');
    detail.className='muted small';
    detail.textContent=reminder.detail;
    const action=document.createElement('span');
    action.className='reminder-action';
    action.textContent=reminder.type==='request'?'Ouvrir la demande →':
      reminder.type==='quote'?'Ouvrir le devis →':'Ouvrir la facture →';
    button.append(heading,client,detail,action);
    root.appendChild(button);
  }
}
async function loadReminders(){
  if(!state.logged)return;
  const version=++reminderRequestVersion;
  const button=$('refreshReminders');
  button.disabled=true;
  try{
    const [quotes,invoices]=await Promise.all([
      callApi('/api/admin/quotes'),callApi('/api/admin/invoices')
    ]);
    if(version!==reminderRequestVersion||!state.logged)return;
    currentReminders=computeManagerReminders(
      state.items,quotes.quotes||[],invoices.invoices||[]
    );
    renderManagerReminders(currentReminders);
  }catch(error){
    if(version===reminderRequestVersion){
      $('remindersList').textContent='Impossible de charger les rappels. Réessaie avec « Actualiser ».';
      $('remindersCount').textContent='—';
    }
    console.warn('Chargement des rappels indisponible',error?.message);
  }finally{
    if(version===reminderRequestVersion)button.disabled=false;
  }
}
$('refreshReminders').addEventListener('click',loadReminders);
document.querySelector('[data-tab="home"]').addEventListener('click',loadReminders);
$('remindersList').addEventListener('click',async event=>{
  const target=event.target.closest('[data-reminder-key]');
  if(!target)return;
  const reminder=currentReminders.find(x=>x.key===target.dataset.reminderKey);
  if(!reminder)return;
  target.disabled=true;
  try{
    if(reminder.type==='request'){
      $('requestFilter').value='all';
      setPage('demandes');
      const booking=state.items.find(x=>x.id===reminder.id);
      if(booking)openEditor(booking);
      else notify('Cette demande ne figure plus dans la liste.');
    }else if(reminder.type==='quote'){
      setPage('devis');
      await loadOfficialQuotes();
      const quote=officialQuoteState.quotes.find(x=>String(x.id)===reminder.id);
      if(quote)fillQuoteForm(quote);
      else notify('Ce devis a été supprimé ou n’est plus accessible.');
    }else if(reminder.type==='invoice'){
      $('invoiceVisibility').value='current';
      setPage('factures');
      await loadInvoices();
      const invoice=invoiceState.invoices.find(x=>x.id===reminder.id);
      if(invoice)fillInvoice(invoice);
      else notify('Cette facture n’est plus accessible.');
    }
  }catch(error){notify(error.message);}
  finally{target.disabled=false;}
});
