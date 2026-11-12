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

// L'agenda n'est plus affiché sur le site. La vérification de disponibilité
// reste effectuée côté serveur lors de l'envoi d'une demande de devis.
const bookingDate = document.getElementById('bookingDate');
const today = new Date();
const todayLocal = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
bookingDate.min = todayLocal;
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
