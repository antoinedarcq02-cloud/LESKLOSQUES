'use strict';
// Tous les secrets restent dans ce navigateur et sont transmis au serveur Cloudflare
// seulement lors du POST de récupération, via HTTPS et avec origine vérifiée.
const byId = id => document.getElementById(id);
const feedback = byId('feedback');
const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%*-_';

function randomString(length, alphabet) {
  const chars = [];
  // Rejet pour éviter le biais du modulo.
  while (chars.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    const limit = 256 - (256 % alphabet.length);
    for (const value of bytes) {
      if (value < limit) chars.push(alphabet[value % alphabet.length]);
      if (chars.length === length) break;
    }
  }
  return chars.join('');
}

function message(value, good = false) {
  feedback.textContent = value;
  feedback.classList.toggle('good', good);
  if (value) feedback.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function copyValue(value, source) {
  try {
    await navigator.clipboard.writeText(value);
    message('Copié. Conserve ce secret dans un endroit privé.', true);
  } catch {
    if (source) {
      const previousType = source.type;
      source.type = 'text';
      source.focus();
      source.select();
      try {
        if (document.execCommand('copy')) {
          message('Copié. Conserve ce secret dans un endroit privé.', true);
          return;
        }
      } finally {
        source.type = previousType;
      }
    }
    message('Copie manuelle nécessaire : sélectionne le champ et utilise Ctrl+C.');
  }
}

byId('makeKey').addEventListener('click', () => {
  byId('setupKey').value = randomString(64, 'abcdef0123456789');
  message('Nouvelle clé créée. Clique sur Copier, puis ajoute-la sous le nom ADMIN_SETUP_KEY dans les secrets Production de Cloudflare.', true);
});
byId('copyKey').addEventListener('click', () => {
  const field = byId('setupKey');
  if (field.value.length < 32) {
    message('Génère d’abord une clé temporaire.');
    return;
  }
  copyValue(field.value, field);
});

document.querySelectorAll('.generatePassword').forEach(button => {
  button.addEventListener('click', () => {
    const n = Number(button.dataset.person);
    const generated = randomString(25, pool);
    byId('pass' + n).value = generated;
    byId('confirm' + n).value = generated;
    message('Mot de passe généré pour ' + byId('name' + n).value + '. Utilise le bouton Copier pour le conserver.', true);
  });
});

document.querySelectorAll('.musician').forEach(block => {
  const n = Number(block.dataset.person);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'secondary';
  copy.textContent = 'Copier ce mot de passe';
  copy.addEventListener('click', () => {
    const field = byId('pass' + n);
    if (!field.value) return message('Choisis ou génère d’abord le mot de passe.');
    copyValue(field.value, field);
  });
  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.className = 'secondary';
  reveal.textContent = 'Afficher / masquer';
  reveal.addEventListener('click', () => {
    const show = byId('pass' + n).type === 'password';
    byId('pass' + n).type = show ? 'text' : 'password';
    byId('confirm' + n).type = show ? 'text' : 'password';
  });
  block.append(copy, reveal);
});

byId('recoveryForm').addEventListener('submit', async event => {
  event.preventDefault();
  message('');
  const setup_key = byId('setupKey').value;
  if (setup_key.length < 32 || setup_key.length > 300)
    return message('Vérifie la clé temporaire Cloudflare : elle doit faire au moins 32 caractères.');

  const users = [];
  for (let n = 0; n < 4; n++) {
    const username = byId('user' + n).value.trim().toLowerCase();
    const display_name = byId('name' + n).value.trim();
    const password = byId('pass' + n).value;
    const confirmation = byId('confirm' + n).value;
    if (!/^[a-z][a-z0-9_-]{2,23}$/.test(username))
      return message('Identifiant invalide pour ' + display_name + ' : 3 à 24 caractères, lettres sans accent, chiffres, tiret ou _.');
    if (display_name.length < 2)
      return message('Renseigne le prénom du musicien numéro ' + (n + 1) + '.');
    if (password.length < 15 || password.length > 128 || password.trim().length < 15)
      return message('Le mot de passe de ' + display_name + ' doit contenir au moins 15 caractères.');
    if (password !== confirmation)
      return message('La confirmation du mot de passe de ' + display_name + ' ne correspond pas.');
    users.push({ username, display_name, password });
  }
  if (new Set(users.map(item => item.username)).size !== 4)
    return message('Les quatre identifiants doivent être différents.');
  if (new Set(users.map(item => item.password)).size !== 4)
    return message('Les quatre mots de passe doivent être différents.');
  if (!byId('ack').checked)
    return message('Coche la confirmation indiquant que tu as sauvegardé les mots de passe et ajouté ADMIN_SETUP_KEY.');

  const button = byId('submitBtn');
  button.disabled = true;
  button.textContent = 'Enregistrement sécurisé…';
  try {
    const response = await fetch('/api/admin/recovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ action: 'rebuild_four', setup_key, users })
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('Réponse inattendue de Cloudflare. Vérifie le déploiement Production.'); }
    if (!response.ok || !data.ok) throw new Error(data.error || 'Enregistrement refusé.');
    for (let i = 0; i < 4; i++) {
      byId('pass' + i).value = '';
      byId('confirm' + i).value = '';
    }
    byId('setupKey').value = '';
    button.hidden = true;
    byId('success').hidden = false;
    message('Succès : les quatre comptes sont enregistrés. Pense à retirer ADMIN_SETUP_KEY de Cloudflare.', true);
  } catch (error) {
    message(error.message || 'Erreur de connexion au serveur.');
  } finally {
    button.disabled = false;
    if (!button.hidden) button.textContent = 'Enregistrer les 4 comptes';
  }
});
