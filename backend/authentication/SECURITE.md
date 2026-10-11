# Documentation — sécurité SEC-02

Préparé et testé localement. Le site et le backend de production ne sont pas modifiés automatiquement.

## Sessions

Le cookie `__Host-mercasport_session` contient un JWT signé HS256. `HttpOnly` empêche sa lecture par le JavaScript du navigateur, `Secure` exige HTTPS et `SameSite=Strict` limite les envois entre sites. Le cookie est sans attribut Domain, avec Path=/, et expire après 30 minutes.

`AUTH_SECRET` doit contenir 32 octets aléatoires encodés en 64 caractères hexadécimaux. Conserver ce secret uniquement dans les variables privées du backend et utiliser le même secret entre instances. Aucun secret réel n’a été créé pour cette livraison.

Le serveur vérifie signature, algorithme, émetteur, destinataire, date d’expiration et ancienneté, puis vérifie la ligne `auth_sessions` et le compte actuel. Une session révoquée ou expirée est refusée. Le JWT ne contient pas le rôle ou l’e-mail. Il est également lié au hash actuel du mot de passe : un changement de ce hash invalide les anciens cookies.

La déconnexion révoque la session courante en SQL et supprime le cookie. Une réinitialisation réussie révoque toutes les sessions du compte. Changer AUTH_SECRET déconnecte tous les comptes. Aucun refresh token n’est ajouté.

## Rôles et permissions

`requirePermission(sessions, {roles, approved})` est un middleware à placer sur les futures routes protégées. Il lit le rôle actuel dans la base, sans faire confiance au formulaire ou au rôle annoncé par le navigateur :

```js
app.get('/action-joueur', requirePermission(sessions, {
  roles: ['PLAYER'], approved: true,
}), handler);
```

- Pas de session valide : 401.
- Rôle non autorisé : 403.
- `approved: true` et compte non APPROVED : 403.
- L’identité du compte est accessible dans `res.locals.identity.userId`.

Les rôles possibles sont PLAYER, CLUB et ADMIN. Les modules de licence vérifient déjà le rôle dans la base. Pour modifier une ressource appartenant à un joueur ou un club, la route doit aussi vérifier son propriétaire : le contrôle du rôle seul ne suffit pas. Les routes actuelles du backend ne deviennent pas protégées sans ajout explicite de ce middleware.

## Origine des requêtes

`APP_ORIGIN` doit être l’origine HTTPS exacte du frontend, sans slash final. La connexion, la déconnexion et la réinitialisation exigent une origine configurée. Les requêtes modifiant des données avec un cookie doivent passer par `sessions.authenticate`, qui vérifie également cette origine. Les GET ne doivent pas modifier de données.

Le montage prévu utilise frontend et API sur la même origine. Ne pas remplacer la liste d’origines par un joker. La configuration des proxys doit être vérifiée pour obtenir l’IP réelle ; ne pas faire confiance à tous les en-têtes X-Forwarded-For.

## Tentatives

`rate-limit.js` stocke les compteurs dans `auth_rate_limits`, partagés entre les instances du backend. Les compteurs sont incrémentés par une requête atomique SQL, afin que deux tentatives simultanées ne contournent pas la limite. Les IP et identifiants ne sont pas stockés en clair : une empreinte HMAC avec le secret du serveur les remplace.

Connexion : 10 requêtes par IP et par identifiant dans une fenêtre de 15 minutes, y compris les connexions réussies. Réinitialisation : 10 requêtes par IP sur 15 minutes ; les demandes de lien sont aussi limitées par e-mail. Une limite de compte atteinte pour un mot de passe oublié conserve la réponse générique 202 pour éviter de révéler ce compte.

Une limite par IP atteinte retourne 429, avec Retry-After. Une panne du limiteur SQL refuse le traitement avec 503 ; elle n’enlève pas la protection. La limite peut être adaptée au nombre d’utilisateurs derrière une IP commune. Les calculs de hash sont aussi limités à deux par instance et par traitement concerné.

Les compteurs expirés sont nettoyés par petits lots. Prévoir une purge périodique des anciennes sessions et des jetons expirés/usés pour contrôler le volume conservé. Les droits de la base et le stockage restent réservés au backend.

## Réinitialisation

Jeton aléatoire de 32 octets ; seule son empreinte est stockée. Expiration à 15 minutes, usage unique, jamais envoyé dans la réponse publique. Le lien utilise une origine fixe configurée et un fragment URL. Le mot de passe est hashé Argon2id ; sa modification, la consommation des jetons et la révocation des sessions sont dans la même transaction.

Aucun e-mail réel ne part. L’adaptateur de file durable reste à choisir ; pas de lien retourné en JSON pour contourner cette étape. Aucune notification par e-mail après changement n’est configurée non plus.

## Activation et limites de la vérification

`security.sql` ajoute `auth_sessions`, `auth_rate_limits` et `password_reset_tokens`. La migration ne supprime pas les tables existantes ; elle a été appliquée uniquement aux bases jetables des tests. Vérifier le schéma cible avant son exécution sur Neon. Les anciens JWT sans ligne de session seront refusés lors de l’activation de cette version.

Les tests ne constituent pas un audit complet de sécurité ni une vérification du déploiement. La configuration HTTPS, les secrets, les proxys, les permissions sur toutes les routes et la consultation des documents devront être contrôlés au branchement.

Références utilisées : [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
