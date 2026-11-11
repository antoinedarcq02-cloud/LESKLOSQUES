# Les Klosques — site avec demande de devis

Version préparée avec la demande de Greg et les deux nouvelles formules. Les anciens tarifs publics ont été retirés du HTML, du JavaScript et des fichiers livrés.

## Modifications visibles

- Nouvelle rubrique « Demander un devis », accessible depuis le menu, l'accueil et chaque carte de formule.
- **5 prestations sans tarif public** :
  1. Concert en auto-gestion sans DJ
  2. Concert en auto-gestion + DJ
  3. Concert avec équipe technique
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
