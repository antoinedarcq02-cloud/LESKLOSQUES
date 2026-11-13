# Klosques Manager — mise en service avec quatre mots de passe personnels

> Mise à jour de la branche `feature/klosques-manager` : l'authentification par code e-mail a été **remplacée**. Aucun service e-mail n'est requis pour se connecter à Klosques Manager. Cette branche n'est **pas** déployée en production.

## Fonctionnement

- Quatre musiciens au maximum, chacun avec **un identifiant et un mot de passe distincts**.
- Premier compte créé une seule fois avec un secret temporaire Cloudflare, puis gestion des trois autres comptes depuis l'onglet **Site** de l'administration.
- Le premier compte est **gestionnaire des comptes** (création et réinitialisation). Les quatre comptes peuvent consulter et modifier concerts, demandes, devis brouillons et contenus du site.
- Les trois comptes ajoutés utilisent un mot de passe provisoire, à **changer obligatoirement à la première connexion**.
- Changement de mot de passe possible depuis le bouton « Mot de passe ». Les autres sessions de ce musicien sont invalidées.
- Pas de vote ni de gestion des disponibilités individuelles.
- Les devis PDF restent des brouillons internes, non des devis officiels.

## Situation actuelle sur Cloudflare

La base D1 de l'utilisateur s'appelle **`klosquesmanager`** (sans tiret) et est déjà reliée au projet Pages via le binding **`DB`** dans les paramètres Production. Les quatre tables de la migration 0001 ont été créées manuellement dans la console D1 :

- `bookings`
- `admin_auth_challenges` (ancienne méthode email, **inutilisée**, peut rester sans risque fonctionnel)
- `admin_login_limits`
- `site_content`

**Ne pas exécuter de DROP sur ces tables et ne pas recréer la base.**

### 1. Créer la table des comptes personnels

Dans Cloudflare > Storage & databases > D1 > `klosquesmanager` > Console, exécuter **seulement** le contenu du fichier :

`migrations/0002_personal_passwords.sql`

Ce fichier crée `admin_users` et une protection limitant le groupe à quatre comptes. Il n'écrase pas les tables existantes.

### 2. Configurer les secrets

Dans Cloudflare > Workers & Pages > **lesklosques** > Settings > Variables and secrets, environnement souhaité :

| Variable | Type | Usage |
| --- | --- | --- |
| `ADMIN_SESSION_SECRET` | Secret | **Déjà configuré** : conserve les sessions signées. Ne pas divulguer. |
| `ADMIN_SETUP_KEY` | **Secret** | **À ajouter avant la première activation**. Utiliser une chaîne aléatoire d'au moins 32 caractères, différente de tout autre secret. Conserver temporairement cette clé pour la copier dans le formulaire d'initialisation de l'administration. |
| `ADMIN_PASSWORD_PEPPER` | **Secret** | **À ajouter et conserver** : chaîne aléatoire d'au moins 32 caractères, différente de `ADMIN_SESSION_SECRET` et de `ADMIN_SETUP_KEY`. Elle protège le hachage des mots de passe, y compris en cas de fuite de D1. **Ne jamais la modifier sans procédure de réinitialisation de tous les comptes.** |
| `ADMIN_EMAILS` | Texte | **Ancien réglage, désormais inutile**. Peut être laissé tel quel pendant les tests puis supprimé. Les mots de passe personnels utilisent `admin_users`. |
| `RESEND_API_KEY` | Secret | **Non nécessaire à la connexion des musiciens**. Toujours nécessaire pour envoyer les demandes de devis du site public via Resend. |
| `EMAIL_FROM` | Texte | **Non nécessaire à la connexion des musiciens**. Toujours nécessaire pour l'expéditeur Resend des demandes de devis. |
| `QUOTE_EMAIL_TO` | Texte facultatif | Adresse de réception des demandes publiques, par défaut `LesKlosques@hotmail.com`. |

Ne pas envoyer les mots de passe ni les secrets dans ChatGPT ou GitHub. Un mot de passe fort est **personnel, différent des autres et comporte 15 à 128 caractères**. Utiliser idéalement un gestionnaire de mots de passe.

### 3. Tester en prévisualisation

Sur une prévisualisation Cloudflare Pages correctement reliée à une **base D1 de test** (ne pas mélanger les comptes et les demandes de test avec la production) :

1. Ouvrir `/admin/`. Le formulaire « Première activation » s'affiche si `admin_users` est vide.
2. Vérifier que `ADMIN_PASSWORD_PEPPER` est déjà enregistré comme **Secret** persistant dans Cloudflare, puis coller `ADMIN_SETUP_KEY` dans ce formulaire et choisir le premier identifiant, prénom et mot de passe personnel.
3. Après création réussie, **supprimer `ADMIN_SETUP_KEY` de Cloudflare** (ou à minima le désactiver ; il ne permet de toute façon plus de recréer le premier compte).
4. Onglet **Site** > **Comptes des quatre musiciens** : ajouter les trois autres comptes avec des mots de passe **provisoires distincts**. Le gestionnaire confirme son propre mot de passe pour chaque création.
5. Transmettre chaque mot de passe provisoire à son musicien directement et de manière privée ; le mot de passe devra être changé à sa première connexion.
6. Tester un mauvais mot de passe, la limite de tentatives, le changement de mot de passe, la révocation de l'ancienne session et l'interdiction d'accéder aux API sans connexion.
7. Tester l'agenda, l'ajout et la modification de concerts, le suivi des dossiers et les modifications de vidéos/textes.

> À ce jour, **aucun de ces tests n'a été exécuté sur Cloudflare** depuis la conversation. L'intégration est prête pour validation, mais pas annoncée comme opérationnelle.

### 4. Publier quand tout est validé

La branche reste séparée de `main`. Une pull request en brouillon est ouverte :

`https://github.com/antoinedarcq02-cloud/LESKLOSQUES/pull/2`

Après tests et configuration Production, passer la PR en état prêt et la fusionner manuellement. Cloudflare Pages peut alors déployer `main` si le site est connecté à GitHub. **Ne pas fusionner avant d'avoir vérifié la migration D1, les protections et les variables.**

## Sécurité

- HMAC-SHA256 du mot de passe avec un **secret serveur indépendant `ADMIN_PASSWORD_PEPPER`**, puis PBKDF2-HMAC-SHA256 à **100 000 itérations** et sel aléatoire de 16 octets par compte. Les mots de passe ne sont jamais enregistrés en clair. Cette valeur respecte le **plafond Cloudflare Workers de 100 000 itérations par opération** (600 000 n'y fonctionne pas). L'utilisation d'un secret côté serveur compense partiellement ce plafond en empêchant les attaques hors ligne à partir d'une simple fuite de D1 ; les mots de passe longs et uniques restent nécessaires.
- Cookie de session signé avec `ADMIN_SESSION_SECRET`, `HttpOnly`, `Secure`, `SameSite=Strict`, 7 jours, et contrôle en base de la version de session. Toute modification/réinitialisation du mot de passe invalide les anciens cookies.
- Limitation des tentatives de connexion à **25 par adresse IP** et **12 par identifiant** sur une fenêtre de 15 minutes.
- Vérification de l'origine des requêtes d'écriture et des droits sur toutes les API d'administration ; les données clients ne sont pas accessibles anonymement.
- Seul le gestionnaire des comptes peut ajouter ou réinitialiser des comptes ; il doit confirmer son mot de passe pour ces opérations.
- Les trois autres comptes créés sont de rôle `member` ; seul le premier a le rôle `admin`.
- Aucun service de réinitialisation par email : en cas d'oubli, demander au gestionnaire de créer un nouveau mot de passe provisoire. **Si le gestionnaire perd le sien**, une récupération par intervention administrative sécurisée sur Cloudflare sera nécessaire ; ne pas stocker un mot de passe de récupération dans GitHub.
- Vérifier les sauvegardes et la politique de conservation des données clients avant la mise en service.

## À ne pas oublier pour le formulaire public

Le formulaire `/api/bookings` continue à expédier une demande de devis par **Resend** avant son archivage D1. Si `RESEND_API_KEY` et `EMAIL_FROM` sont absents ou mal configurés, **le formulaire public ne pourra toujours pas envoyer de demandes**. Cela n'affecte pas la connexion par mot de passe à Klosques Manager.

> Important : les secrets de Preview et Production sont indépendants selon la configuration Cloudflare. Configurer `ADMIN_PASSWORD_PEPPER` et `ADMIN_SESSION_SECRET` dans chaque environnement de test avec des valeurs propres à cet environnement, et ne pas modifier ces secrets après création des comptes.

## Écran de bienvenue BD personnalisé (en préparation)

- Après une connexion réussie, afficher brièvement une illustration de concert avec un musicien souriant, une bulle BD et la barre « Accès à Klosques Manager ».
- Le prénom apparaît **dynamiquement depuis `display_name`** de la session, via `textContent`, par exemple « Bienvenue Greg ! », « Bienvenue Jérémy ! », etc. Une image fixe ne doit pas déterminer le prénom affiché.
- L’illustration **sélectionnée par le groupe** doit être déposée dans `admin/klosques-welcome.webp` sur la branche `feature/klosques-manager`. Le composant masque l’inscription « Antoine » imprimée dans l’image en redessinant la bulle au-dessus.
- Le visuel ne change pas les règles d’authentification. L’écran s’affiche après une connexion manuelle (ou après le changement du mot de passe provisoire), puis laisse place au tableau de bord. Il ne bloque pas une session existante rechargée.
- Respecte `prefers-reduced-motion` : animation de chargement désactivée et délai de bienvenue raccourci.
- **Ne pas fusionner dans `main`** tant que l’image n’a pas été ajoutée et que le rendu sur mobile n’est pas vérifié en Preview.

