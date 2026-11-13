# Configuration e-mail — Les Klosques

Cette fonctionnalité **n'envoie rien tant que les secrets Cloudflare et les options d'activation ne sont pas configurés**. Les demandes clients continuent à être enregistrées dans D1 même si la messagerie est indisponible.

## 1. Préparer un expéditeur Resend

1. Ouvrir https://resend.com/domains et ajouter **un domaine que Les Klosques possède** (par exemple `lesklosques.fr` si acquis). Il est impossible de vérifier `hotmail.com` ou le sous-domaine mutualisé `pages.dev` pour se faire passer pour son propriétaire.
2. Ajouter les enregistrements DNS demandés par Resend (SPF, DKIM, etc.) auprès de l'hébergeur DNS, puis attendre le statut « Verified » de l'envoi.
3. Dans https://resend.com/api-keys, créer une clé de type « Sending access » et la copier directement dans les **secrets** Cloudflare. **Ne jamais coller une clé dans ChatGPT, GitHub, une capture d'écran ou un message.**
4. Choisir un expéditeur appartenant au domaine vérifié, par exemple `contact@lesklosques.fr` (exemple seulement : ne pas créer cette adresse tant que le domaine n'est pas possédé/vérifié).

Le client peut répondre aux e-mails vers `LesKlosques@hotmail.com` (Reply-To). Cette adresse reste également la destination par défaut des alertes du groupe.

## 2. Variables dans Cloudflare Pages

Aller dans **Cloudflare → Workers & Pages → lesklosques → Settings → Variables and Secrets → Production**.

| Clé | Type | Exemple / valeur |
| --- | --- | --- |
| `RESEND_API_KEY` | **Secret chiffré** | Clé Resend réelle, jamais dans Git |
| `RESEND_FROM_EMAIL` | Texte | Adresse du domaine vérifié (ex. `contact@lesklosques.fr`) |
| `BOOKING_NOTIFICATION_TO` | Texte optionnel | `LesKlosques@hotmail.com`, ou 1 à 4 adresses séparées par des virgules |
| `BOOKING_ALERTS_ENABLED` | Texte | `true` pour avertir l'équipe lors d'une demande |
| `BOOKING_RECEIPT_ENABLED` | Texte | `false` pendant les essais ; passer à `true` pour l'accusé de réception automatique au client |

Les anciennes variables `EMAIL` et `QUOTE_FROM_EMAIL` du système de devis peuvent coexister ; lorsque Resend est complètement renseigné, les e-mails PDF privilégient Resend.

**Important :** appliquer les variables à l'environnement Production, et redéployer le site après modification des secrets. Les environnements Preview sont séparés.

## 3. Vérifier sans utiliser une vraie facture

1. Après redéploiement, se connecter avec le **compte responsable** sur https://lesklosques.pages.dev/admin/.
2. Ouvrir **Site → Messagerie et notifications** : la présence des variables et l'activation des alertes s'affichent, mais cela ne garantit pas encore la vérification DNS.
3. Cliquer **Envoyer un e-mail de test** ; le test est adressé uniquement à la première adresse de `BOOKING_NOTIFICATION_TO` (Hotmail par défaut). Maximum un essai toutes les deux minutes.
4. Contrôler la boîte de réception et le dossier indésirables. « Accepté par Resend » ne prouve pas la livraison effective.
5. Activer ensuite `BOOKING_ALERTS_ENABLED=true`, puis, après confirmation du bon fonctionnement, `BOOKING_RECEIPT_ENABLED=true`. Redéployer après modifications.
6. Les prochaines demandes reçues sur le formulaire public seront toujours enregistrées dans D1. Si activées, les alertes internes et l'accusé de réception partent **après** cet enregistrement. Un échec e-mail n'efface jamais le dossier.

Les e-mails automatiques **ne confirment jamais une réservation ni un devis**. L'envoi d'un devis finalisé ou d'une facture émise reste manuel et soumis à confirmation explicite dans Manager. Ne pas utiliser une facture de test existante pour vérifier cette configuration.

## 4. Dépannage

- **Resend non configuré :** vérifier `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, Production et le redéploiement.
- **Variables détectées, test refusé :** vérifier que le domaine d'envoi est bien « Verified » et que la clé a les droits d'envoi.
- **Test accepté, e-mail introuvable :** vérifier les spams et la rubrique Emails/Logs de Resend. Le code ne peut certifier que le destinataire a effectivement reçu l'e-mail.
- **Alerte désactivée :** mettre `BOOKING_ALERTS_ENABLED` exactement à `true`.
- **Accusé désactivé :** mettre `BOOKING_RECEIPT_ENABLED` exactement à `true`.
- **Historique en D1 :** table `booking_email_logs` pour les demandes, table `admin_email_test` pour le diagnostic ; création automatique.

Références :
- https://resend.com/docs
- https://developers.cloudflare.com/pages/functions/bindings/#secrets
