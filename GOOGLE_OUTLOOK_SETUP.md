# Klosques Manager — connecter Google Agenda et Hotmail

Les deux connecteurs sont prêts côté application, mais **aucun compte n'est connecté ni synchronisé depuis GitHub seul**. Le responsable doit créer les applications OAuth, enregistrer leurs identifiants dans Cloudflare puis accorder explicitement l'accès à Google/Microsoft.

URL d'administration : https://lesklosques.pages.dev/admin/

## 1. Google Agenda

**Préparer Google Cloud**

1. Dans https://console.cloud.google.com/, créer ou sélectionner un projet et activer **Google Calendar API**.
2. Configurer l'écran de consentement OAuth et les utilisateurs de test si l'application est en mode test. Des jetons de renouvellement peuvent expirer après 7 jours sur certaines applications externes en mode test : prévoir la publication de l'application appropriée si nécessaire.
3. Créer un identifiant OAuth de type **Application Web** et renseigner cette URI exacte de redirection :
   `https://lesklosques.pages.dev/api/admin/connect/google/callback`
4. Dans Cloudflare Pages → lesklosques → Paramètres → Variables et secrets (**Production**), ajouter :

| Variable | Type | Valeur |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | texte | ID client OAuth du projet |
| `GOOGLE_CLIENT_SECRET` | secret | secret client OAuth |
| `GOOGLE_CALENDAR_ID` | texte optionnel | identifiant du calendrier **du groupe**, sinon `primary` |

5. Redéployer si nécessaire et, depuis le compte responsable, ouvrir **Site → Connexions → Connecter Google Agenda**.
6. Se connecter au compte Google propriétaire du calendrier choisi et accepter les droits proposés : consultation/édition d'événements et disponibilité libre/occupé.

**Dans Agenda :** les événements Google du mois sont affichés en plus de ceux du Manager. Le responsable dispose de boutons **Ajouter à Google / Mettre à jour / Retirer de Google** pour les concerts confirmés. Chaque action est soumise à confirmation. Les événements créés par Klosques Manager ont un identifiant déterministe et un marquage qui évite les doublons et protège les autres événements Google. Aucune modification automatique lors d'un changement de statut d'un concert : actualiser/retirer explicitement sur Google si le dossier change.

Les fiches concerts existantes n'ont qu'une date (pas une heure de début/fin fiable). Les concerts sont donc publiés **en journée entière**, en privé, sans contacts clients, invitations ni notes internes. Aucun événement externe n'est importé comme nouveau concert du Manager. L'agenda Google n'est pas effacé par une déconnexion.

**Ancienne configuration :** si `GOOGLE_REFRESH_TOKEN` existe déjà dans les secrets, la lecture de disponibilité reste compatible. Un jeton qui n'a pas les autorisations d'édition doit être remplacé par la connexion OAuth depuis le Manager. Pour couper complètement l'ancien accès, supprimer cette variable dans Cloudflare.

## 2. Boîte mail LesKlosques@hotmail.com

**Préparer Microsoft Entra**

1. Dans https://entra.microsoft.com/ → **App registrations** / Inscriptions d'applications, créer une nouvelle application acceptant **les comptes Microsoft personnels** (ou personnels et comptes d'organisation).
2. Type de redirection : **Web**, URI exacte :
   `https://lesklosques.pages.dev/api/admin/connect/microsoft/callback`
3. Ajouter les permissions Microsoft Graph **déléguées** `Mail.Read` et `User.Read`. L'application demande également `offline_access` lors de la connexion pour pouvoir lire de nouveaux messages ultérieurement.
4. Créer un secret client et enregistrer dans Cloudflare Pages Production :

| Variable | Type | Valeur |
| --- | --- | --- |
| `MICROSOFT_CLIENT_ID` | texte | Application (client) ID Microsoft |
| `MICROSOFT_CLIENT_SECRET` | secret | secret client Microsoft (la **valeur**, pas l'ID du secret) |
| `OUTLOOK_EXPECTED_EMAIL` | texte facultatif | `LesKlosques@hotmail.com` par défaut |

5. Ouvrir Manager avec le compte responsable → **Site → Connexions → Connecter Hotmail**, s'identifier avec le compte **LesKlosques@hotmail.com** et accepter les droits de lecture.
6. Utiliser l'onglet **Boîte mail** pour voir les **20 derniers messages** de la boîte de réception. Cliquer **Actualiser la boîte** pour recharger les données, ou **Ouvrir dans Outlook** pour répondre dans Microsoft.

**Confidentialité :** seuls les comptes de Klosques Manager de rôle administrateur ont accès à la boîte Hotmail. Les contenus ne sont pas copiés dans D1. Le code ne supprime, ne marque comme lu, ne répond et n'envoie aucun message. Aucun accès `Mail.Send` ou `Mail.ReadWrite` n'est demandé.

### Distinction importante : boîte reçue ≠ envoi des devis et factures

Ce connecteur lit la boîte Hotmail, mais **n'active pas l'envoi de devis/factures depuis Hotmail**. La fonction d'envoi de documents existante reste basée sur Resend, nécessite un domaine d'expédition vérifié et l'accord manuel dans le Manager : voir [EMAIL_SETUP.md](EMAIL_SETUP.md). L'adresse Hotmail reste le Reply-To.

## 3. Sécurité, contrôle et diagnostic

- Tous les appels externes passent par des API privées Cloudflare Pages, protégées par la session Klosques Manager.
- Les jetons de renouvellement OAuth sont chiffrés côté serveur dans D1 avec AES-GCM, à partir du secret `ADMIN_SESSION_SECRET` via HKDF ; les secrets et jetons ne sont **jamais** retournés au navigateur.
- **Ne pas modifier `ADMIN_SESSION_SECRET`** : il protège aussi les sessions existantes ; cela empêcherait la lecture des jetons OAuth déjà stockés.
- L'autorisation OAuth utilise un code de vérification PKCE S256, un état aléatoire à usage unique et un cookie CSRF HttpOnly/Secure/SameSite=Lax.
- Le bouton **Déconnecter** supprime le jeton stocké côté Manager, pas les événements ou e-mails déjà présents chez Google/Microsoft.
- Le responsable doit vérifier la connexion dans **Site → Connexions** puis le calendrier dans **Agenda**, et la boîte dans **Boîte mail**.
- L'application n'exécute aucun traitement en arrière-plan : l'agenda et la boîte sont consultés à l'ouverture/actualisation ; les événements sont publiés uniquement après un clic confirmé.
- Les identifiants OAuth appartiennent à la configuration **Production** de Cloudflare, et non à GitHub ou à ChatGPT. Ne partage jamais les secrets, mots de passe ou jetons dans une conversation.

Références :
- Google Calendar OAuth : https://developers.google.com/identity/protocols/oauth2/web-server
- Google Calendar Events : https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- Microsoft OAuth : https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Microsoft Graph messages : https://learn.microsoft.com/en-us/graph/api/user-list-messages
