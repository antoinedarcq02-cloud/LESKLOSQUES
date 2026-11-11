# Les Klosques — site avec agenda et demandes de réservation

Cette version ajoute :
- des icônes Instagram et Facebook dans l'en-tête et le bas de page, sur ordinateur et mobile ;
- un calendrier public qui affiche uniquement les jours occupés (sans révéler les titres, lieux ou détails des événements Google) ;
- un formulaire qui envoie une demande à `antoine.darcq@laposte.net` via Resend ;
- une vérification côté serveur de la date avant l'envoi ;
- les demandes restent des demandes : aucune réservation n'est confirmée automatiquement.

## Réseaux sociaux : liens officiels configurés

Les icônes Instagram et Facebook sont visibles en haut et en bas du site. Elles ouvrent les pages officielles des Klosques dans un nouvel onglet :

- Instagram : https://www.instagram.com/les_klosques/
- Facebook : https://www.facebook.com/ze.klosques/

Les liens sont intégrés à `index.html` et à `script.js`. Aucune autre configuration n'est nécessaire pour les réseaux sociaux.

Pour publier cette mise à jour, remplacer les fichiers correspondants dans le dépôt GitHub (ou redéployer le site avec Cloudflare Pages selon votre méthode habituelle). Les variables et secrets Cloudflare restent dans Cloudflare, jamais dans le ZIP ni dans GitHub.

## Déploiement Cloudflare Pages

Les fichiers `index.html`, `styles.css`, `script.js` et le dossier `functions/` doivent être à la racine du dépôt GitHub.

Dans Cloudflare Pages :
- Framework preset : `None`
- Build command : `exit 0`
- Build output directory : `.`
- Root directory : laisser vide (si les fichiers sont à la racine du dépôt)

Les fonctions `functions/api/availability.js` et `functions/api/bookings.js` sont publiées automatiquement avec Pages Functions.

## 1. Configurer Google Agenda (lecture seule des disponibilités)

Il faut autoriser l'application à consulter les périodes occupées du calendrier. Aucun mot de passe Google ne doit être communiqué ni ajouté au dépôt.

1. Dans Google Cloud Console, créez/sélectionnez un projet et activez **Google Calendar API**.
2. Configurez l'écran de consentement OAuth.
3. Créez un identifiant OAuth de type **Application Web**. Ajoutez `https://developers.google.com/oauthplayground` comme URI de redirection autorisée.
4. Ouvrez Google OAuth 2.0 Playground (`https://developers.google.com/oauthplayground`), ouvrez les paramètres (roue dentée), cochez **Use your own OAuth credentials**, puis renseignez l'identifiant et le secret OAuth.
5. Dans Step 1, saisissez le scope `https://www.googleapis.com/auth/calendar.freebusy`, autorisez l'accès avec le compte Google qui possède/partage l'agenda des Klosques.
6. Dans Step 2, échangez le code contre les jetons et récupérez le **Refresh token**. Conservez-le confidentiel.
7. Dans Cloudflare Pages > votre projet > Settings > Variables and Secrets, ajoutez les variables de production suivantes (type secret pour les valeurs sensibles) :
   - `GOOGLE_CLIENT_ID` : identifiant OAuth
   - `GOOGLE_CLIENT_SECRET` : secret OAuth (secret)
   - `GOOGLE_REFRESH_TOKEN` : refresh token (secret)
   - `GOOGLE_CALENDAR_ID` : `primary` si c'est l'agenda principal du compte connecté ; sinon l'identifiant exact du calendrier partagé.
8. Relancez un déploiement après avoir enregistré les variables.

Le compte Google autorisé doit avoir au minimum accès aux informations de disponibilité du calendrier. Si l'agenda est partagé avec un autre compte, vérifiez que ce compte peut consulter les informations de disponibilité.

## 2. Configurer l'envoi automatique des e-mails

Cette version utilise Resend (`https://resend.com/`) pour envoyer les demandes.

1. Créez un compte Resend.
2. Ajoutez et vérifiez un domaine d'expédition que vous contrôlez dans Resend (il faut publier les enregistrements DNS indiqués par Resend).
3. Créez une clé API.
4. Dans Cloudflare Pages > Settings > Variables and Secrets, ajoutez :
   - `RESEND_API_KEY` : clé API Resend (secret)
   - `EMAIL_FROM` : expéditeur vérifié, par exemple `Les Klosques <reservations@votre-domaine.fr>`
5. Relancez le déploiement.

Important : Resend ne permet pas d'envoyer librement depuis une adresse `@laposte.net` qui n'a pas été vérifiée comme domaine d'expédition. Il faut un domaine que vous contrôlez et vérifiez, ou choisir un autre fournisseur d'e-mail compatible.

## 3. Vérifications après configuration

- Ouvrir `/api/availability?month=2026-11` sur le site : la réponse doit être un JSON contenant `busyDates`.
- Sur le site, vérifier que les jours occupés apparaissent en rouge.
- Faire une demande test : un e-mail doit arriver à `antoine.darcq@laposte.net`.
- Une date occupée est refusée par le serveur même si le formulaire est manipulé.

## Limites de cette version

- Les demandes sont envoyées par e-mail mais ne sont pas encore enregistrées dans une base de données ni visibles dans un espace membre.
- Il n'y a pas encore de bouton d'approbation/refus ni de création automatique d'événement Google après validation.
- Les jours sans événement occupé sont affichés comme « a priori disponibles » ; confirmez toujours avec le groupe avant de promettre une date.
- L'agenda public ne reçoit que les périodes occupées et n'expose pas les détails des événements.
- Les variables secrètes se configurent dans Cloudflare, jamais dans les fichiers GitHub.
