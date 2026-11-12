# Les Klosques — site avec demande de devis

Version préparée avec la demande de Greg et les deux nouvelles formules. Les anciens tarifs publics ont été retirés du HTML, du JavaScript et des fichiers livrés.

## Modifications visibles

- Nouvelle rubrique « Demander un devis », accessible depuis le menu, l'accueil et chaque carte de formule.
- **5 prestations sans tarif public** :
  1. Concert en auto-gestion sans DJ
  2. Concert en auto-gestion + DJ
  3. Concert avec équipe technique (sans DJ)
  4. Concert avec équipe technique + DJ
  5. Concert avec remorque (configuration à préciser)
- Formulaire en deux étapes : choix de la formule dans un menu déroulant, puis coordonnées et informations sur l'événement.
- Les champs obligatoires sont : formule, nom / organisation, e-mail, téléphone, type d'événement, date, lieu.
- Une fois le formulaire validé, une demande est adressée au groupe à **LesKlosques@hotmail.com**, et non un devis automatique au prospect.
- Le groupe doit **valider** le devis avant de l'envoyer lui-même au client. La génération et l'envoi de devis par IA après accord ne sont **pas encore intégrés** ; cela nécessitera un espace de gestion sécurisé et un processus d'approbation.
- Aucune fonction de suivi individuel des visiteurs anonymes n'a été ajoutée. Les coordonnées ne sont recueillies qu'au moment de l'envoi du formulaire.

Le logo des Klosques, l'icône basse de Galdric, les liens Facebook / Instagram, l'agenda public et les autres éléments du site sont conservés.

## Mise en ligne via GitHub et Cloudflare Pages

Décompressez le ZIP et remplacez **les fichiers à la racine du dépôt GitHub** (pas dans un dossier supplémentaire). Conservez le dossier `assets/` et `functions/`.

Paramètres Cloudflare Pages si besoin :
- Production branch : `main`
- Framework preset : `None`
- Build command : `exit 0`
- Build output directory : `.`

Lors de la publication via GitHub, Cloudflare Pages doit relancer le déploiement. Les secrets Cloudflare ne sont **pas** inclus dans le ZIP. Après le déploiement, tester `https://VOTRE-SITE.pages.dev/#devis` et l'envoi d'une demande.

## Variables Cloudflare nécessaires pour recevoir les demandes

Dans **Cloudflare Pages > projet connecté à GitHub > Settings > Variables and Secrets**, en environnement **Production** :

- `RESEND_API_KEY` : **Secret**, clé API Resend.
- `EMAIL_FROM` : **Text**, adresse d'expédition correspondant à un **domaine vérifié dans Resend**, par exemple `Les Klosques <devis@votre-domaine.fr>`.

**Attention** : avec l'adresse de test `onboarding@resend.dev`, Resend ne permet généralement pas d'envoyer des messages vers une adresse Hotmail extérieure au compte Resend. Pour que le formulaire envoie bien les demandes à **LesKlosques@hotmail.com**, un domaine expéditeur vérifié (ou un autre service d'e-mail configuré) est indispensable. Le fait de changer le destinataire dans le code ne suffit pas.

## Agenda Google

Conservez les variables et secrets de Production si vous utilisez Google Agenda :
- `GOOGLE_CLIENT_ID` : Secret
- `GOOGLE_CLIENT_SECRET` : Secret
- `GOOGLE_REFRESH_TOKEN` : Secret
- `GOOGLE_CALENDAR_ID` : identifiant exact du calendrier partagé

Le calendrier public n'affiche que les périodes occupées, sans détails des événements. Si Google Agenda est indisponible lors d'une demande de devis, le formulaire peut encore transmettre la demande au groupe, avec mention « Disponibilité à vérifier ».

Si l'application Google OAuth est encore en statut **Test**, une autorisation de ce type peut expirer ; vérifier le calendrier en production. Ne mettez aucun secret dans GitHub.

## Protection des données et limites

- Les coordonnées des prospects sont recueillies pour répondre à leur demande de devis et transmises par e-mail au groupe. Pas de suivi nominatif des visiteurs ne soumettant pas le formulaire.
- Ajouter une vraie politique de confidentialité avant une diffusion commerciale durable (responsable, finalités, conservation, droits, contact), adaptée à vos pratiques de traitement.
- Le site n'archive pas encore les demandes dans une base de données, n'a pas d'espace privé d'approbation et n'envoie pas de devis PDF automatisé.
- Les descriptions de « Équipe technique + DJ » et « Avec remorque » ne spécifient pas de durée ni de tarif : ces éléments restent à définir par le groupe.
- La messagerie et l'agenda doivent être testés **sur le nouveau projet Pages** : les variables de l'ancien projet ne sont pas automatiquement transférées.


## Portraits des membres

Les photos de Greg, Jeremy, Antoine et Galdric sont enregistrées dans `assets/` sous les noms `greg-sur-scene.webp`, `jeremy-sur-scene.webp`, `antoine-sur-scene.webp` et `galdric-sur-scene.webp`. Elles sont intégrées à la section « Le groupe ».

Pour une mise à jour depuis GitHub, publier `index.html`, `styles.css` et les quatre nouveaux fichiers image dans `assets/`. Les fonctions Cloudflare existantes ne sont pas modifiées.


## Mise à jour du 12 novembre 2026 — vidéo YouTube

- Section « Agenda » remplacée sur la page par « Les Klosques en live ! ».
- Vidéo intégrée : https://www.youtube.com/watch?v=kUTlcbnGmgw (lecteur YouTube respectueux de la vie privée, sans lecture automatique).
- Lien de navigation renommé « Vidéo » ; bouton permettant d'ouvrir la vidéo directement sur YouTube.
- L'API Google Agenda et la vérification de disponibilité côté serveur dans le formulaire de devis sont **conservées**. Aucun secret Cloudflare n'est contenu dans ce ZIP.
- Autres sections, formules, photos, réseaux sociaux et fonctionnement des demandes de devis laissés inchangés.
- Pour publier, remplacer les fichiers du dépôt par le contenu **décompressé** du ZIP (ne pas ajouter de dossier parent). Si votre projet utilise un téléversement direct dans Cloudflare Pages, publier les fichiers selon la méthode propre à ce projet plutôt que d'attendre un déploiement GitHub.
- L'intégration de la vidéo dépend de l'autorisation d'intégration définie par la vidéo sur YouTube ; en cas de blocage par YouTube, le bouton « Voir la vidéo sur YouTube » reste utilisable.


## Mise à jour — trois vidéos YouTube

La rubrique « Les Klosques en live ! » affiche maintenant la première vidéo en grand et deux vidéos complémentaires côte à côte sur ordinateur (empilées sur mobile) :

- https://www.youtube.com/watch?v=kUTlcbnGmgw
- https://www.youtube.com/watch?v=njdBF5e3U4s
- https://www.youtube.com/watch?v=JQyRAMXzBfA

Chaque vidéo utilise un lecteur `youtube-nocookie.com`, sans lecture automatique, et possède un lien « Voir sur YouTube » en cas de restriction d'intégration. Les autres fonctionnalités (formulaire, fonctions Cloudflare, Google Agenda côté serveur, photos, logo, réseau sociaux et formules) sont inchangées.

Pour publier : décompressez l'archive et remplacez les fichiers correspondants à la racine du dépôt GitHub connecté à Cloudflare Pages ; vérifiez ensuite le nouveau déploiement. Aucun secret n'est inclus.


## Mise à jour — quatrième vidéo Facebook Reel

La rubrique « Les Klosques en live ! » conserve les trois vidéos YouTube et ajoute une quatrième vidéo, un Reel Facebook public :

- https://www.facebook.com/reel/1098640118264832/

La quatrième vidéo est intégrée au moyen du lecteur Facebook (`facebook.com/plugins/video.php`), au format vertical. Un lien « Voir le Reel sur Facebook » est toujours visible : selon les paramètres de visibilité du Reel, les restrictions de Facebook ou le navigateur, le lecteur intégré peut ne pas fonctionner. Le Reel doit être public et autoriser son intégration.

Aucun compte ni clé Facebook n'est nécessaire pour cette intégration. Le lecteur peut charger des ressources de Facebook quand le visiteur arrive à la zone vidéo (chargement différé / `loading=lazy`). Les intégrations YouTube, le logo, les formules, le formulaire, les réseaux sociaux et les fonctions Cloudflare/Google Agenda restent inchangés.

Pour publier : décompressez ce ZIP et remplacez son contenu à la racine du dépôt GitHub ; Cloudflare Pages lancera le déploiement si votre dépôt est connecté. Les secrets Cloudflare ne sont pas dans cette archive.


## Logo coloré (novembre 2026)
Le logo transmis `assets/logo-klosques-couleur.jpg` est affiché dans l'en-tête et en grand sur l'accueil. Le nouvel icône de navigateur est `assets/favicon-klosques.png`. L'ancien logo blanc reste présent dans le pied de page, et le visuel de fond d'accueil est inchangé.

Le fichier fourni fait 160 × 160 pixels : une version originale de plus haute résolution permettra un affichage encore plus net sur grands écrans. Les quatre lecteurs vidéo, les liens sociaux et les fonctions de réservation/API n'ont pas été modifiés.


## Correction du Reel Facebook (12 novembre 2026)
Le sélecteur conserve les trois vidéos YouTube au format horizontal (16:9). Lorsque la vidéo Facebook est sélectionnée, le lecteur adopte un format vertical (9:16) centré, adapté aussi au téléphone. Le lien direct Facebook reste disponible si Facebook refuse la lecture intégrée (par exemple selon les paramètres de confidentialité, le navigateur ou la connexion Facebook).
