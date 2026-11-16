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
| `GOOGLE_KLOSQUES_CALENDAR_ID` | texte optionnel | ID de **KLOSQUES PARTAGE**, utile uniquement si plusieurs calendriers portent ce nom |
| `GOOGLE_KLOSQUES_UNAVAILABLE_CALENDAR_ID` | texte optionnel | ID de **KLOSQUES PAS DISPO PARTAGE** en cas d'homonymes |

5. Redéployer si nécessaire et, depuis le compte responsable, ouvrir **Site → Connexions → Connecter Google Agenda**. Le compte Google choisi doit disposer dans sa liste de calendriers des deux agendas partagés suivants, avec leurs noms exacts : **KLOSQUES PARTAGE** et **KLOSQUES PAS DISPO PARTAGE**. Si le compte avait déjà été autorisé auparavant, **reconnecte-le** pour accorder la permission de lire la liste des calendriers (`calendar.calendarlist.readonly`).
6. Se connecter au compte Google propriétaire du calendrier choisi et accepter les droits proposés : consultation/édition d'événements et disponibilité libre/occupé.

**Dans Agenda :** la grille mensuelle et la liste **Agenda commun** regroupent directement les dossiers concerts du Manager et les événements des deux agendas partagés **KLOSQUES PARTAGE** et **KLOSQUES PAS DISPO PARTAGE**, avec une légende et des couleurs distinctes. Les titres d'événement sont ceux inscrits sur Google, y compris pour **PAS DISPO** (s'ils sont accessibles au compte connecté). Les périodes de plusieurs jours occupent chaque case correspondante. Pour éviter les doublons, les concerts Google déjà liés à une fiche Manager existante n'apparaissent qu'une fois dans cette vue. L'accès à cet agenda est réservé aux musiciens authentifiés. Aucun agenda personnel n'est consulté. Si l'un des calendriers manque ou si la permission de lecture de liste manque, la lecture échoue au lieu de basculer sur l'agenda personnel. Le contrôle de disponibilité des nouvelles demandes porte uniquement sur ces deux agendas.

**Dans Site → Connexions :** le responsable dispose des boutons **Ajouter à Google / Mettre à jour / Retirer de Google** pour les concerts confirmés, dans la rubrique de synchronisation. Chaque action est soumise à confirmation. Les événements créés par Klosques Manager ont un identifiant déterministe et un marquage qui évite les doublons et protège les autres événements Google. Aucune modification automatique lors d'un changement de statut d'un concert : actualiser/retirer explicitement sur Google si le dossier change.

**Demandes clients automatiquement inscrites dans Google :**

- Une nouvelle demande **« En attente de traitement » (statut `nouveau`) reste dans « Demandes clients »** et n'apparaît pas dans l'Agenda commun ni dans Google Agenda.
- **Après passage à « En discussion »**, ou à une étape ultérieure (devis envoyé, en option, confirmé, terminé), la demande issue du site apparaît automatiquement dans **KLOSQUES PARTAGE**, sur la date demandée, en journée entière. Ce n'est pas une réservation confirmée tant que son statut n'est pas « Confirmé ». 
- L'événement est **transparent (libre)** tant que le statut n'est pas « Confirmé » : les autres visiteurs peuvent continuer à demander la même date. Au statut « Confirmé », il devient **occupé**.
- Lorsque le statut, le lieu ou la date d'une demande issue du site change dans Manager, l'événement Google correspondant est mis à jour sans doublon. Au retour vers « En attente de traitement » ou au statut « Refusé », une tentative de suppression/mise à jour Google est effectuée, avec avertissement en cas d'échec. **Supprimer la demande** retire immédiatement la fiche du Manager et tente de retirer son événement Google dans le même appel. Si Google refuse ou est hors ligne, une entrée de suppression est conservée dans D1 et une nouvelle tentative est effectuée automatiquement lors des prochaines ouvertures de l'Agenda commun, sans second clic sur la demande. Le Manager affiche alors « suppression Google en attente » au lieu d'affirmer qu'elle a réussi. Les anciennes entrées orphelines identifiables sont également traitées à l'ouverture de l'Agenda, après vérification des marqueurs privés, sans toucher aux événements créés manuellement par les musiciens.
- L'événement contient **le statut, la date, le lieu et une référence interne**, jamais l'e-mail, le téléphone, le message ou les autres données du client. L'accès au dossier complet reste dans Manager. Les événements ne sont créés que dans **KLOSQUES PARTAGE**, jamais dans PAS DISPO ni dans un agenda personnel.
- **La demande reste enregistrée même si Google Agenda est momentanément indisponible.** La publication peut être retentée en modifiant/enregistrant un dossier ayant quitté l'attente. Les demandes en attente restent masquées dans le Manager, même lorsqu'une ancienne entrée Google ne peut pas encore être nettoyée.
- Les concerts créés manuellement dans Manager ne sont pas touchés par ce déclencheur automatique, et les événements Google créés directement depuis Agenda restent indépendants.

**Supprimer un événement depuis Agenda commun :** « Retirer uniquement de Google » conserve la fiche Manager pour une demande liée. Le bouton distinct **Supprimer la demande et son événement** efface la demande du Manager et traite son événement Google (immédiatement ou, si Google échoue, via la file de suppression). Pour les événements sans demande liée, « Supprimer de Google Agenda » agit seulement sur l'un des deux agendas partagés après confirmation. Le serveur revérifie le calendrier, les droits d'écriture et la version de l'événement avant toute suppression directe. La suppression d'une occurrence récurrente ne supprime pas nécessairement toute la série.

**Créer directement un événement Google depuis Agenda commun :**

1. Se connecter avec **l'un des quatre comptes de musicien** de Klosques Manager (administrateur ou membre). Les visiteurs du site public n'y ont pas accès ; l'administrateur garde seul la configuration de la connexion OAuth.
2. Ouvrir **Agenda → + Événement Google**.
3. Choisir **KLOSQUES PARTAGE** (répétitions/concerts) ou **KLOSQUES PAS DISPO PARTAGE** (indisponibilités).
4. Renseigner le titre, les dates inclusives et, si souhaité, décocher *Toute la journée* pour préciser les heures en fuseau `Europe/Paris`. Le lieu et les notes sont facultatifs.
5. Confirmer explicitement l'enregistrement. L'événement est créé **directement sur le calendrier Google partagé choisi**, sans fiche concert locale et sans notification ni invitation automatique. L'agenda commun est actualisé et affiche le même événement.
6. Les droits d'**écriture** du compte Google partagé connecté sont nécessaires sur le calendrier choisi. Tous les musiciens utilisent la **même connexion Google du groupe** via Manager, sans devoir connecter quatre comptes personnels. En cas d'échec réseau, réessayer **dans le même formulaire** : son identifiant unique permet d'éviter les doublons. Pour modifier un événement manuel après création, utiliser Google Agenda ; il peut être supprimé depuis l'Agenda commun de Klosques Manager. Les outils **Ajouter / Mettre à jour / Retirer de Google** de Site → Connexions restent réservés aux concerts confirmés issus des fiches Manager.

Les fiches concerts existantes n'ont qu'une date (pas une heure de début/fin fiable). Les concerts sont donc publiés **en journée entière**, en privé, sans contacts clients, invitations ni notes internes. Aucun événement externe n'est importé comme nouveau concert du Manager. L'agenda Google n'est pas effacé par une déconnexion.

**Ancienne configuration :** si `GOOGLE_REFRESH_TOKEN` existe déjà dans les secrets, il peut encore être utilisé, mais **il doit avoir la permission de lire la liste des calendriers** pour que ce fonctionnement marche. Le plus simple est de reconnecter Google depuis Manager et de donner les nouvelles autorisations. Pour couper complètement l'ancien accès, supprimer `GOOGLE_REFRESH_TOKEN` de Cloudflare. L'ancien `GOOGLE_CALENDAR_ID` n'est plus utilisé pour sélectionner ces deux calendriers : la sélection se fait exclusivement d'après les noms partagés précités (et les IDs optionnels en cas de doublon).

## 2. Boîte mail LesKlosques@hotmail.com : recevoir et envoyer

**Préparer Microsoft Entra pour le compte personnel Hotmail du groupe**

1. Dans https://entra.microsoft.com/ → **App registrations**, créer ou sélectionner une application qui accepte **les comptes Microsoft personnels**.
2. Type de redirection : **Web**, URI exacte : `https://lesklosques.pages.dev/api/admin/connect/microsoft/callback`.
3. Ajouter les permissions **déléguées** Microsoft Graph `User.Read`, `Mail.Read`, `Mail.Send` et `offline_access` ; `Mail.Send` permet l'expédition depuis le compte autorisé, y compris depuis un compte Microsoft personnel.
4. Dans **Cloudflare Pages → lesklosques → Production → Variables et secrets**, renseigner `MICROSOFT_CLIENT_ID` (texte) et `MICROSOFT_CLIENT_SECRET` (secret chiffré). Facultatif : `OUTLOOK_EXPECTED_EMAIL=LesKlosques@hotmail.com`.
5. Après le déploiement, ouvrir **Manager → Site → Connexions → Connecter Hotmail / Autoriser l'envoi Hotmail** avec le compte responsable. Se connecter **uniquement** à `LesKlosques@hotmail.com`, puis accepter la permission d'envoi `Mail.Send` et les autres permissions affichées.
6. **Même si Hotmail était déjà connecté pour lire la boîte**, il faut le **réautoriser** : l'ancien jeton n'avait pas la permission `Mail.Send`. Le Manager ne considère pas la messagerie prête à envoyer tant que cette nouvelle autorisation n'a pas été enregistrée.
7. Ouvrir **Site → Messagerie et notifications → Envoyer un e-mail de test**, puis vérifier la boîte de réception, les indésirables et les éléments envoyés de Hotmail. Le test n'envoie jamais de devis ni de facture.

**Fonctionnement**

- **Nouvelles demandes :** après leur enregistrement dans la base D1 par le formulaire du site, une notification contenant les renseignements de la demande est envoyée automatiquement à `LesKlosques@hotmail.com` depuis ce même compte Hotmail. Aucune réservation n'est confirmée par cet e-mail. Le dossier demeure sauvegardé si Microsoft Graph est indisponible.
- **Devis :** un devis **finalisé** et lié à une demande contenant l'adresse e-mail du client peut être envoyé manuellement, après confirmation, avec son PDF en pièce jointe.
- **Factures :** une facture **émise** peut être envoyée manuellement, après confirmation, avec son PDF en pièce jointe. Les e-mails figurent dans les éléments envoyés du compte Hotmail.
- **Lecture de la boîte :** l'onglet **Boîte mail** permet toujours au responsable de consulter les 20 derniers messages sans les marquer comme lus.
- **Expéditeur alternatif :** la configuration Resend existante reste utilisable si Hotmail n'est pas autorisé à envoyer. Il n'est plus nécessaire d'acheter ou de vérifier un domaine d'envoi Resend pour utiliser les fonctions Hotmail.
- **Alertes du groupe :** elles sont actives par défaut dès que Hotmail est autorisé à envoyer ; pour les désactiver explicitement, utiliser `BOOKING_ALERTS_ENABLED=false`. L'adresse de destination est `BOOKING_NOTIFICATION_TO`, par défaut `LesKlosques@hotmail.com` (1 à 4 adresses).
- **Accusé de réception automatique au client :** reste **désactivé par défaut**. La configuration existante Resend avec `BOOKING_RECEIPT_ENABLED=true` demeure nécessaire pour cette option ; ce n'est pas un envoi de devis ni une confirmation de réservation.

**Confidentialité et garanties :** aucun mot de passe ni jeton OAuth n'est enregistré dans GitHub ou dans le navigateur. Les jetons restent chiffrés dans D1. Les envois de documents sont réservés aux musiciens connectés et nécessitent une confirmation explicite ; l'accès à la boîte reçue, aux autorisations OAuth et aux tests de messagerie reste réservé au responsable. Microsoft Graph confirme une **acceptation** du message (HTTP 202), pas sa livraison certaine ; consulter les éléments envoyés et les éventuels retours d'erreur.

Références :
- https://learn.microsoft.com/fr-fr/graph/api/user-sendmail?view=graph-rest-1.0
- https://learn.microsoft.com/fr-fr/graph/permissions-reference
- https://learn.microsoft.com/fr-fr/entra/identity-platform/v2-oauth2-auth-code-flow

## 3. Sécurité, contrôle et diagnostic

- Tous les appels externes passent par des API privées Cloudflare Pages, protégées par la session Klosques Manager.
- Les jetons de renouvellement OAuth sont chiffrés côté serveur dans D1 avec AES-GCM, à partir du secret `ADMIN_SESSION_SECRET` via HKDF ; les secrets et jetons ne sont **jamais** retournés au navigateur.
- **Ne pas modifier `ADMIN_SESSION_SECRET`** : il protège aussi les sessions existantes ; cela empêcherait la lecture des jetons OAuth déjà stockés.
- L'autorisation OAuth utilise un code de vérification PKCE S256, un état aléatoire à usage unique et un cookie CSRF HttpOnly/Secure/SameSite=Lax.
- Le bouton **Déconnecter** supprime le jeton stocké côté Manager, pas les événements ou e-mails déjà présents chez Google/Microsoft.
- Le responsable doit vérifier la connexion dans **Site → Connexions** puis le calendrier dans **Agenda**, et la boîte dans **Boîte mail**.
- Les créations manuelles d'événements depuis Agenda restent soumises à confirmation. **Exception : les demandes du site qui ont dépassé l'étape « En attente de traitement » sont synchronisées automatiquement** avec KLOSQUES PARTAGE lors de la mise à jour du dossier ; la synchronisation n'annule pas son enregistrement en cas d'incident Google. Les demandes tout juste reçues ne sont pas publiées. Aucun visiteur public n'a accès aux API d'administration ou aux jetons OAuth.
- Les identifiants OAuth appartiennent à la configuration **Production** de Cloudflare, et non à GitHub ou à ChatGPT. Ne partage jamais les secrets, mots de passe ou jetons dans une conversation.

Références :
- Google Calendar OAuth : https://developers.google.com/identity/protocols/oauth2/web-server
- Google Calendar Events : https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- Microsoft OAuth : https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Microsoft Graph messages : https://learn.microsoft.com/en-us/graph/api/user-list-messages
