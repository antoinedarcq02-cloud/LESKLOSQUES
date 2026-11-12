# Klosques Manager — mise en service Cloudflare

## Ce que contient cette branche

- Espace privé mobile sur `/admin/` ; quatre personnes autorisées se connectent individuellement avec un code temporaire reçu par e-mail.
- Tableau de bord, demandes issues du formulaire, agenda des **concerts** (pas des disponibilités individuelles), fiches et notes du groupe.
- Saisie manuelle des concerts et changement de statut : nouveau, en discussion, devis envoyé, option, confirmé, terminé, refusé.
- Montant indicatif et **impression d'un brouillon de proposition** ; **pas de devis officiel ni d'envoi automatique**. Les mentions légales, la numérotation, les conditions et la validation doivent être prévues avant de produire des devis officiels.
- Éditeur de textes d'accueil/présentation et identifiants de trois vidéos YouTube + du Reel Facebook ; les photos restent gérées dans GitHub.
- Demandes envoyées au groupe par Resend comme avant, puis archivées en base D1 si la base existe.
- Lien discret « Espace musiciens » dans le pied de page publique.

**Non inclus :** planning de disponibilités des musiciens, votes, notifications individuelles, envoi de devis officiels, upload de photos, synchronisation à double sens avec Google Agenda, migration d'anciennes demandes reçues par email.

## Avant fusion / mise en production

**1. Créer une base Cloudflare D1** appelée `klosques-manager` (nom libre). Dans le tableau de bord D1 ou avec Wrangler, exécuter le fichier SQL `migrations/0001_manager.sql`. Exemple depuis une copie du dépôt :

```sh
npx wrangler d1 execute klosques-manager --remote --file=migrations/0001_manager.sql
```

**2. Lier D1 au projet Cloudflare Pages qui héberge le vrai site** :

Workers & Pages > projet Pages > Settings > Bindings > Add > D1 database > Variable name : `DB` > sélectionner la base. Faire de même en environnement Preview si on souhaite tester une branche de prévisualisation. Redéployer le projet après la liaison.

**3. Définir les variables et secrets du projet Pages**, dans l'environnement approprié :

| Nom | Type | Utilité |
| --- | --- | --- |
| `ADMIN_EMAILS` | Texte | Les **quatre** adresses des musiciens, séparées par des virgules, sans espace nécessaire ; aucune adresse inventée dans le code. |
| `ADMIN_SESSION_SECRET` | Secret | Chaîne aléatoire longue et imprévisible (minimum 32 caractères), **différente** des autres secrets. Ne jamais la commiter dans GitHub. |
| `RESEND_API_KEY` | Secret | Déjà utilisée pour les demandes de devis : nécessaire aussi pour envoyer les codes de connexion. |
| `EMAIL_FROM` | Texte | Expéditeur vérifié chez Resend, autorisé à envoyer aux quatre musiciens. |
| `QUOTE_EMAIL_TO` | Texte optionnel | Boîte de réception des demandes du site, par défaut `LesKlosques@hotmail.com`. |

Il n'est pas nécessaire de communiquer ces secrets dans le chat. Vérifier dans Resend que l'expéditeur est accepté pour chaque destinataire : les domaines non vérifiés et l'adresse `onboarding@resend.dev` sont limités.

**4. Tester sur Preview** : ouvrir `/admin/`, se connecter avec une adresse autorisée, vérifier le refus d'une adresse non autorisée, ajouter un concert test, modifier son statut et ses notes, générer un brouillon imprimable, modifier un texte de test, puis envoyer **une demande de devis test** sur le site public et vérifier (a) son email, (b) sa fiche dans la rubrique Demandes. Supprimer ensuite les données fictives depuis la console D1 ou les identifier clairement ; l'interface ne fournit volontairement pas de suppression.

**5. Après validation**, fusionner la branche dans `main` et laisser Cloudflare Pages déployer le projet relié à GitHub. Si Pages est publié par upload manuel plutôt que via GitHub, une synchronisation manuelle sera nécessaire.

## Sécurité et données

- Une page HTML d'identification peut être consultée par toute personne connaissant `/admin/`, mais **aucune donnée client n'est exposée sans cookie de session signé et adresse présente dans la liste autorisée**.
- Code de connexion à six chiffres, valable dix minutes, cinq essais maximum par code, limitation par IP et délai d'une minute entre envois pour la même adresse.
- Session signée sur sept jours, cookie `HttpOnly`, `Secure`, `SameSite=Strict`, requêtes d'écriture contrôlées par origine. Déconnexion disponible.
- Les quatre comptes autorisés peuvent modifier tous les dossiers et les contenus publics ; définir plus tard des rôles distincts si souhaité.
- Les demandes clients sont stockées après confirmation d'envoi de l'email. Si D1 tombe en panne, la demande peut quand même arriver par email sans apparaître dans Manager : vérifier les logs.
- Prévoir une politique de confidentialité mise à jour, une politique de conservation et de purge des données clients, et des sauvegardes de D1 avant utilisation réelle.
- Le système d'impression est volontairement libellé « BROUILLON INTERNE » ; ne pas le présenter comme un devis conforme avant validation des mentions et données de facturation.

## Points à finaliser avant usage complet

- Obtenir et saisir les quatre adresses de connexion sur Cloudflare.
- Choisir la personne responsable de la validation des devis officiels.
- Configurer D1 et vérifier l'envoi des codes Resend.
- Tester réellement le déploiement, notamment les Functions et l'envoi du formulaire, puis contrôler les logs.

Cette branche est une **implémentation à valider**, pas une installation terminée en production.
