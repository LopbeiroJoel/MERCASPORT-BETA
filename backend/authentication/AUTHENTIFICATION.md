# Documentation — authentification

Responsable : Joel. AUTH-02 a été livré sur `api/registration`. Les évolutions SEC-02 / AUTH-03 présentées ici sont livrées sur api/registration et restent à intégrer. Le serveur actuel et le frontend n’ont pas été branchés à ces modules. Aucun e-mail réel n’est envoyé et aucune migration n’a été appliquée à Neon.

## AUTH-02 : se connecter

`POST /auth/login` reçoit :

```json
{"identifier":"Joel Lopes Ribeiro","password":"mot de passe saisi"}
```

`identifier` contient l’e-mail ou le pseudo. Le serveur cherche le compte dans `users`, puis compare le mot de passe avec `password_hash`. Il accepte Argon2id et les anciens formats scrypt/bcrypt pris en charge par ce projet. Un compte inconnu et un mauvais mot de passe produisent la même réponse 401. Le mot de passe n’est ni enregistré ni retourné en clair.

Si la connexion réussit, le navigateur reçoit un cookie sécurisé, valable 30 minutes, et le JSON contient les informations publiques du compte. Le rôle et le statut sont relus dans la base pour les permissions. Un compte PENDING ou REJECTED peut se connecter pour poursuivre son dossier ; l’accès à une action nécessitant une approbation doit être protégé séparément.

La mise à jour SEC-02 enregistre désormais chaque session dans `auth_sessions`. Appliquer `security.sql` avant de brancher cette version de la connexion.

## Déconnexion

`POST /auth/logout` ne nécessite pas de champ JSON. La route exige une origine autorisée, révoque la session courante dans la base, efface le cookie et retourne 204. Le même cookie ne permet plus de se connecter, même s’il a été copié avant la déconnexion. Les autres sessions du compte restent valables.

## AUTH-03 : mot de passe oublié

`POST /auth/forgot-password` reçoit :

```json
{"email":"joel@example.invalid"}
```

Lorsque l’envoi sera configuré, le serveur créera un jeton aléatoire de 32 octets, valable 15 minutes, dont seule l’empreinte SHA-256 sera gardée dans `password_reset_tokens`. Le lien prévu est `https://DOMAINE/reset-password#token=JETON`. Le domaine vient de la configuration du serveur, jamais de la requête du visiteur.

Le lien passe uniquement à l’adaptateur privé `enqueueResetLink({email, link})`, qui devra déposer un travail dans une file durable. L’API ne renvoie pas le lien ni le jeton au demandeur et ne les journalise pas. La réponse 202 est identique pour un compte connu ou inconnu, un compte limité et une panne d’envoi ; un délai minimum de 500 ms réduit les différences de durée. L’adaptateur doit répondre rapidement ; une intégration lente devra être revue avant activation.

**Actuellement, aucun adaptateur d’e-mail n’est configuré. Cette route retourne 503 `RESET_DELIVERY_NOT_CONFIGURED` et ne crée pas de lien pour les utilisateurs réels.** Les tests utilisent uniquement une file fictive. AUTH-01, confirmation de l’adresse e-mail, reste reporté.

## Changer le mot de passe avec le lien

`POST /auth/reset-password` reçoit :

```json
{
  "token":"jeton reçu dans le lien",
  "password":"Ma nouvelle longue phrase de passe !",
  "password_confirmation":"Ma nouvelle longue phrase de passe !"
}
```

Le serveur vérifie le jeton, son expiration et son utilisation précédente. Le nouveau mot de passe doit respecter les règles de l’inscription : 15 à 128 caractères, maximum 512 octets, sans caractères de contrôle, sans suppression des espaces du mot de passe. Les deux saisies doivent correspondre.

Dans une transaction SQL, le serveur remplace le hash par Argon2id, consomme tous les liens de réinitialisation du compte et révoque toutes ses sessions. Le statut du compte et `is_verified` restent inchangés. Le visiteur doit ensuite se reconnecter : aucune connexion automatique n’est créée. Deux utilisations simultanées du même lien ne peuvent pas réussir toutes les deux. Une erreur SQL annule l’ensemble des modifications.

La page frontend `/reset-password` reste à créer et à brancher. Elle devra lire le fragment du lien, demander la double saisie puis envoyer le POST. Éviter tout script publicitaire/analytique sur cette page et appliquer une politique `Referrer-Policy: no-referrer`. Aucun formulaire frontend n’a été modifié ici.

## TEST-01 : parcours vérifié

Le test API utilise un joueur et un administrateur fictifs : inscription → connexion → dépôt de licence → validation ADMIN → permission joueur approuvé → déconnexion → lien fictif → changement du mot de passe → nouvelle connexion. Il contrôle aussi le parcours CLUB, les refus, les liens expirés ou déjà utilisés et les pannes SQL.

Il s’agit de tests HTTP des modules avec PostgreSQL embarqué, stockage de licence fictif et file d’envoi fictive. Cela ne valide pas encore les pages du navigateur, les e-mails réels, Neon ou le déploiement Vercel. La valeur « 299 » de TEST-01 a été remplacée par cette description du parcours, conformément à la clarification de Joel.
