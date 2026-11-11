// Liens officiels des Klosques vers Instagram et Facebook.
const SOCIAL_PAGES = {
  instagram: 'https://www.instagram.com/les_klosques/',
  facebook: 'https://www.facebook.com/ze.klosques/'
};

document.querySelectorAll('[data-social]').forEach(icon => {
  const service = icon.dataset.social;
  const link = (SOCIAL_PAGES[service] || '').trim();
  try {
    const parsed = new URL(link);
    const domain = parsed.hostname.toLowerCase();
    const allowed = service === 'instagram'
      ? (domain === 'instagram.com' || domain === 'www.instagram.com')
      : (domain === 'facebook.com' || domain === 'www.facebook.com' || domain === 'm.facebook.com' || domain === 'fb.com' || domain === 'www.fb.com');
    if (parsed.protocol !== 'https:' || !allowed) return;
    icon.href = parsed.href;
    icon.setAttribute('aria-label', service === 'instagram' ? 'Visiter notre page Instagram' : 'Visiter notre page Facebook');
    icon.title = service === 'instagram' ? 'Instagram des Klosques' : 'Facebook des Klosques';
  } catch (_) {
    // Aucun lien saisi : l'icône reste sans destination.
  }
});

const menuToggle=document.getElementById('menuToggle');
const nav=document.getElementById('mainNav');
menuToggle.addEventListener('click',()=>{const open=nav.classList.toggle('open');menuToggle.setAttribute('aria-expanded',String(open));});
nav.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{nav.classList.remove('open');menuToggle.setAttribute('aria-expanded','false');}));
document.getElementById('year').textContent=new Date().getFullYear();
// La formule choisie dans une carte est reportée dans le menu du devis.
const quoteForm = document.getElementById('bookingForm');
const quotePackage = document.getElementById('quotePackage');
const quoteStep1 = document.getElementById('quoteStep1');
const quoteStep2 = document.getElementById('quoteStep2');
const quoteStatus = document.getElementById('formStatus');
const quoteContinue = document.getElementById('quoteContinue');
const quoteBack = document.getElementById('quoteBack');
const quoteSelected = document.getElementById('selectedPackage');
function showQuoteStep(number) {
  const first = number === 1;
  quoteStep1.hidden = !first;
  quoteStep2.hidden = first;
  if (!first) quoteSelected.textContent = `Prestation choisie : ${quotePackage.selectedOptions[0].textContent}`;
}
document.querySelectorAll('[data-package]').forEach(link => {
  link.addEventListener('click', () => {
    quotePackage.value = link.dataset.package;
    quoteStatus.textContent = '';
    showQuoteStep(1);
  });
});
quoteContinue.addEventListener('click', () => {
  if (!quotePackage.value) {
    quotePackage.reportValidity();
    return;
  }
  quoteStatus.textContent = '';
  showQuoteStep(2);
  quoteStep2.querySelector('input[name="name"]').focus({ preventScroll: true });
});
quoteBack.addEventListener('click', () => {
  quoteStatus.textContent = '';
  showQuoteStep(1);
  quotePackage.focus({ preventScroll: true });
});

const monthTitle=document.getElementById('calendarMonth'),calendarGrid=document.getElementById('calendarGrid'),calendarStatus=document.getElementById('calendarStatus'),bookingDate=document.getElementById('bookingDate');
let shownMonth=new Date();shownMonth.setDate(1);let busyDates=new Set();
const monthNames=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'],dayNames=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
function dateKey(y,m,d){return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
function renderCalendar(){const y=shownMonth.getFullYear(),m=shownMonth.getMonth();monthTitle.textContent=monthNames[m][0].toUpperCase()+monthNames[m].slice(1)+' '+y;calendarGrid.innerHTML='';dayNames.forEach(n=>{const el=document.createElement('div');el.className='calendar-day-name';el.textContent=n;calendarGrid.append(el);});const offset=(new Date(y,m,1).getDay()+6)%7,count=new Date(y,m+1,0).getDate();for(let i=0;i<offset;i++){const el=document.createElement('div');el.className='calendar-day empty';calendarGrid.append(el);}for(let d=1;d<=count;d++){const key=dateKey(y,m,d),el=document.createElement('div');el.className='calendar-day '+(busyDates.has(key)?'busy':'available');el.textContent=d;el.title=busyDates.has(key)?'Groupe indisponible':'Aucune indisponibilité connue';calendarGrid.append(el);}}
async function loadAvailability(){renderCalendar();calendarStatus.textContent='Mise à jour des disponibilités…';const y=shownMonth.getFullYear(),m=String(shownMonth.getMonth()+1).padStart(2,'0');try{const response=await fetch(`/api/availability?month=${y}-${m}`);if(!response.ok)throw new Error();const data=await response.json();busyDates=new Set(data.busyDates||[]);renderCalendar();calendarStatus.textContent='Agenda Google synchronisé. Une demande reste soumise à validation par le groupe.';bookingDate.min=todayLocal;}catch(e){calendarStatus.textContent='Les disponibilités ne sont pas encore configurées. Contactez-nous pour vérifier une date.';}}
document.getElementById('prevMonth').addEventListener('click',()=>{shownMonth.setMonth(shownMonth.getMonth()-1);loadAvailability();});
document.getElementById('nextMonth').addEventListener('click',()=>{shownMonth.setMonth(shownMonth.getMonth()+1);loadAvailability();});
bookingDate.addEventListener('change',()=>{if(busyDates.has(bookingDate.value)){calendarStatus.textContent='Cette date est déjà occupée. Merci d’en choisir une autre.';bookingDate.value='';}});
const today = new Date();
const todayLocal = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
bookingDate.min = todayLocal;
loadAvailability();
quoteForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!quotePackage.value) {
    showQuoteStep(1);
    quotePackage.reportValidity();
    return;
  }
  if (!quoteForm.checkValidity()) {
    if (quoteStep2.hidden) showQuoteStep(2);
    quoteForm.reportValidity();
    return;
  }
  const form = new FormData(quoteForm);
  const button = document.getElementById('quoteSubmit');
  const payload = Object.fromEntries(['name', 'email', 'phone', 'eventType', 'location', 'date', 'package', 'message', 'website'].map(k => [k, form.get(k)]));
  button.disabled = true;
  quoteStatus.textContent = 'Envoi de votre demande de devis…';
  try {
    const response = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Impossible d’envoyer votre demande.');
    quoteForm.reset();
    showQuoteStep(1);
    quoteStatus.textContent = 'Merci ! Votre demande de devis a été transmise au groupe. Nous reviendrons vers vous après étude et validation. Aucun devis n’est envoyé automatiquement.';
  } catch (error) {
    quoteStatus.textContent = `${error.message} Vous pouvez aussi nous écrire à LesKlosques@hotmail.com.`;
  } finally {
    button.disabled = false;
  }
});
