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
  quoteStatus.textContent = 'Enregistrement de votre demande de devis…';
  try {
    const response = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || result.saved !== true) throw new Error(result.error || 'Impossible d’enregistrer votre demande.');
    quoteForm.reset();
    showQuoteStep(1);
    quoteStatus.textContent = 'Merci ! Votre demande de devis a bien été enregistrée. Les Klosques vont l’étudier et vous répondront personnellement. Aucun devis ni réservation n’est confirmé automatiquement.';
  } catch (error) {
    quoteStatus.textContent = `${error.message} Vous pouvez aussi nous écrire à LesKlosques@hotmail.com.`;
  } finally {
    button.disabled = false;
  }
});


// Les quatre miniatures affichent une seule vidéo dans le grand lecteur.
// YouTube n'autorise pas la suppression totale des recommandations : rel=0 les
// limite à la chaîne de la vidéo. L'API IFrame permet d'afficher notre écran
// « Revoir cette vidéo » dès que la vidéo se termine.
const KLOSQUES_VIDEOS = [
  {
    source: 'YouTube', id: 'kUTlcbnGmgw',
    page: 'https://www.youtube.com/watch?v=kUTlcbnGmgw'
  },
  {
    source: 'YouTube', id: 'njdBF5e3U4s',
    page: 'https://www.youtube.com/watch?v=njdBF5e3U4s'
  },
  {
    source: 'YouTube', id: 'JQyRAMXzBfA',
    page: 'https://www.youtube.com/watch?v=JQyRAMXzBfA'
  },
  {
    source: 'Facebook Reel',
    player: 'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Freel%2F1098640118264832%2F&show_text=false&width=344',
    page: 'https://www.facebook.com/reel/1098640118264832/'
  }
];

const videoChoices = document.querySelectorAll('.video-choice');
const videoShell = document.getElementById('videoPlayerShell');
const videoLabel = document.getElementById('featuredVideoLabel');
const videoLink = document.getElementById('featuredVideoLink');
const videoNote = document.getElementById('videoEmbedNote');
const videoStatus = document.getElementById('videoSelectionStatus');
const replayPanel = document.getElementById('videoReplayPanel');
const replayPoster = document.getElementById('videoReplayPoster');
const replayButton = document.getElementById('videoReplayButton');
let videoFrame = document.getElementById('featuredVideo');
let youtubePlayer = null;
let currentVideoIndex = 0;

function youtubeEmbedUrl(id, autoplay = false) {
  const url = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  url.searchParams.set('rel', '0'); // Suggestions limitées à cette chaîne YouTube.
  url.searchParams.set('enablejsapi', '1');
  url.searchParams.set('playsinline', '1');
  if (autoplay) url.searchParams.set('autoplay', '1');
  if (location.protocol === 'https:') url.searchParams.set('origin', location.origin);
  return url.toString();
}

function attachYouTubeEndListener() {
  if (!videoFrame || !window.YT || !window.YT.Player ||
      KLOSQUES_VIDEOS[currentVideoIndex].source !== 'YouTube' || youtubePlayer) return;
  const activeFrame = videoFrame;
  try {
    youtubePlayer = new YT.Player(activeFrame, {
      events: {
        onStateChange(event) {
          // L'API signale 0 quand la lecture est entièrement terminée.
          if (event.data !== 0 || KLOSQUES_VIDEOS[currentVideoIndex].source !== 'YouTube' ||
              activeFrame !== videoFrame) return;
          const video = KLOSQUES_VIDEOS[currentVideoIndex];
          replayPoster.src = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
          replayPanel.hidden = false;
          // On remplace le lecteur terminé par notre propre invitation à revoir
          // la vidéo, pour éviter de laisser affiché l'écran de suggestions.
          try { event.target.destroy(); } catch (_) { activeFrame.remove(); }
          youtubePlayer = null;
          videoFrame = null;
          videoStatus.textContent = 'Vidéo terminée. Vous pouvez la revoir ou choisir une autre vidéo.';
        }
      }
    });
  } catch (_) {
    youtubePlayer = null; // Le lecteur standard YouTube continue de fonctionner.
  }
}

function removePreviousPlayer() {
  if (youtubePlayer) {
    try { youtubePlayer.destroy(); } catch (_) { /* Iframe nettoyée ci-dessous. */ }
    youtubePlayer = null;
  }
  const previousFrame = videoShell.querySelector('iframe');
  if (previousFrame) previousFrame.remove();
  videoFrame = null;
}

function makeVideoFrame(url, title) {
  const frame = document.createElement('iframe');
  frame.id = 'featuredVideo';
  frame.title = title;
  frame.loading = 'lazy';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
  frame.allowFullscreen = true;
  frame.src = url;
  videoShell.insertBefore(frame, replayPanel);
  videoFrame = frame;
}

function selectVideo(index, autoplay = false) {
  const video = KLOSQUES_VIDEOS[index];
  if (!video || !videoShell) return;
  const isFacebook = video.source === 'Facebook Reel';
  currentVideoIndex = index;
  removePreviousPlayer();
  replayPanel.hidden = true;
  videoShell.classList.toggle('is-facebook', isFacebook);
  videoShell.closest('.video-main')?.classList.toggle('is-facebook-selected', isFacebook);
  if (isFacebook) {
    const facebookUrl = new URL(video.player);
    const width = Math.max(220, Math.round(videoShell.clientWidth));
    facebookUrl.searchParams.set('width', String(width));
    facebookUrl.searchParams.set('height', String(Math.round(width * 9 / 16)));
    facebookUrl.searchParams.set('show_text', 'false');
    makeVideoFrame(facebookUrl.toString(), 'Les Klosques en live — vidéo 4, Facebook Reel');
  } else {
    makeVideoFrame(youtubeEmbedUrl(video.id, autoplay), `Les Klosques en live — vidéo ${index + 1} sur YouTube`);
    attachYouTubeEndListener();
  }
  videoLabel.textContent = `VIDÉO ${String(index + 1).padStart(2, '0')} · ${video.source.toUpperCase()}`;
  videoLink.href = video.page;
  videoLink.textContent = isFacebook ? 'Voir sur Facebook ↗' : 'Voir sur YouTube ↗';
  videoNote.hidden = !isFacebook;
  videoChoices.forEach(choice => {
    const active = Number(choice.dataset.videoIndex) === index;
    choice.classList.toggle('is-active', active);
    choice.setAttribute('aria-pressed', String(active));
  });
  videoStatus.textContent = `Vidéo ${index + 1} (${video.source}) affichée dans le grand lecteur.`;
}

if (videoShell && videoFrame && videoLabel && videoLink && replayPanel && replayButton) {
  // Conserve la première vidéo visible même si l'API YouTube est indisponible.
  videoFrame.src = youtubeEmbedUrl(KLOSQUES_VIDEOS[0].id);
  videoChoices.forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.videoIndex);
    if (index === currentVideoIndex && replayPanel.hidden === true) return;
    selectVideo(index);
  }));
  replayButton.addEventListener('click', () => selectVideo(currentVideoIndex, true));

  // API officielle YouTube pour savoir quand la lecture se termine.
  // Si elle est bloquée, rel=0 réduit malgré tout les recommandations externes.
  window.onYouTubeIframeAPIReady = attachYouTubeEndListener;
  if (window.YT && window.YT.Player) {
    attachYouTubeEndListener();
  } else {
    const apiScript = document.createElement('script');
    apiScript.src = 'https://www.youtube.com/iframe_api';
    apiScript.async = true;
    document.head.appendChild(apiScript);
  }
}


// Contenus éditables depuis Klosques Manager ; valeurs statiques en secours.
(async function syncPublicContent() {
  try {
    const response = await fetch('/api/site-content', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    const values = payload.content || {};
    const fields = {
      hero_lead: '.hero-lead',
      hero_copy: '.hero-copy',
      intro_text: '.intro > p:not(.eyebrow)'
    };
    for (const [key, selector] of Object.entries(fields)) {
      const target = document.querySelector(selector);
      if (target && typeof values[key] === 'string' && values[key].trim())
        target.textContent = values[key];
    }
    let videoChanged = false;
    for (let index = 0; index < 3; index++) {
      const id = values['video_' + (index + 1)];
      if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '')) continue;
      if (KLOSQUES_VIDEOS[index].id !== id) videoChanged = true;
      KLOSQUES_VIDEOS[index].id = id;
      KLOSQUES_VIDEOS[index].page = 'https://www.youtube.com/watch?v=' + id;
      const thumbnail = document.querySelector('[data-video-index="' + index + '"] img');
      if (thumbnail) thumbnail.src = 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
    }
    if (/^\d{8,25}$/.test(values.facebook_reel || '')) {
      const id = values.facebook_reel;
      const page = 'https://www.facebook.com/reel/' + id + '/';
      if (KLOSQUES_VIDEOS[3].page !== page) videoChanged = true;
      KLOSQUES_VIDEOS[3].page = page;
      const url = new URL('https://www.facebook.com/plugins/video.php');
      url.searchParams.set('href', page);
      url.searchParams.set('show_text', 'false');
      url.searchParams.set('width', '344');
      KLOSQUES_VIDEOS[3].player = url.toString();
    }
    if (videoChanged && videoShell) selectVideo(0);
  } catch (_) {
    // En cas d'indisponibilité de D1, le site continue d'utiliser ses textes et vidéos d'origine.
  }
})();
