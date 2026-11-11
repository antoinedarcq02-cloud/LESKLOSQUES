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
document.querySelectorAll('[data-package]').forEach(link=>link.addEventListener('click',()=>{document.querySelector('select[name="package"]').value=link.dataset.package;}));

const monthTitle=document.getElementById('calendarMonth'),calendarGrid=document.getElementById('calendarGrid'),calendarStatus=document.getElementById('calendarStatus'),bookingDate=document.getElementById('bookingDate');
let shownMonth=new Date();shownMonth.setDate(1);let busyDates=new Set();
const monthNames=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'],dayNames=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
function dateKey(y,m,d){return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
function renderCalendar(){const y=shownMonth.getFullYear(),m=shownMonth.getMonth();monthTitle.textContent=monthNames[m][0].toUpperCase()+monthNames[m].slice(1)+' '+y;calendarGrid.innerHTML='';dayNames.forEach(n=>{const el=document.createElement('div');el.className='calendar-day-name';el.textContent=n;calendarGrid.append(el);});const offset=(new Date(y,m,1).getDay()+6)%7,count=new Date(y,m+1,0).getDate();for(let i=0;i<offset;i++){const el=document.createElement('div');el.className='calendar-day empty';calendarGrid.append(el);}for(let d=1;d<=count;d++){const key=dateKey(y,m,d),el=document.createElement('div');el.className='calendar-day '+(busyDates.has(key)?'busy':'available');el.textContent=d;el.title=busyDates.has(key)?'Groupe indisponible':'Aucune indisponibilité connue';calendarGrid.append(el);}}
async function loadAvailability(){renderCalendar();calendarStatus.textContent='Mise à jour des disponibilités…';const y=shownMonth.getFullYear(),m=String(shownMonth.getMonth()+1).padStart(2,'0');try{const response=await fetch(`/api/availability?month=${y}-${m}`);if(!response.ok)throw new Error();const data=await response.json();busyDates=new Set(data.busyDates||[]);renderCalendar();calendarStatus.textContent='Agenda Google synchronisé. Une demande reste soumise à validation par le groupe.';bookingDate.min=new Date().toISOString().slice(0,10);}catch(e){calendarStatus.textContent='Les disponibilités ne sont pas encore configurées. Contactez-nous pour vérifier une date.';}}
document.getElementById('prevMonth').addEventListener('click',()=>{shownMonth.setMonth(shownMonth.getMonth()-1);loadAvailability();});
document.getElementById('nextMonth').addEventListener('click',()=>{shownMonth.setMonth(shownMonth.getMonth()+1);loadAvailability();});
bookingDate.addEventListener('change',()=>{if(busyDates.has(bookingDate.value)){calendarStatus.textContent='Cette date est déjà occupée. Merci d’en choisir une autre.';bookingDate.value='';}});
loadAvailability();
document.getElementById('bookingForm').addEventListener('submit',async event=>{event.preventDefault();const formEl=event.currentTarget,form=new FormData(formEl),button=formEl.querySelector('button[type="submit"]'),status=document.getElementById('formStatus');const payload=Object.fromEntries(['name','email','phone','location','date','package','message','website'].map(k=>[k,form.get(k)]));button.disabled=true;status.textContent='Envoi de votre demande…';try{const response=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Impossible d’envoyer la demande.');status.textContent='Merci ! Votre demande a bien été envoyée. Le groupe reviendra vers vous pour confirmation.';formEl.reset();}catch(error){status.textContent=error.message+' Vous pouvez aussi écrire à LesKlosques@hotmail.com.';}finally{button.disabled=false;}});
