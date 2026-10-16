# API MercaSport

Le front et l’API partagent la même origine : `http://localhost:3000` en local,
le domaine du projet sur Vercel. Les appels navigateur utilisent `/ads` et `/ads/:id`.
Les annonces viennent de PostgreSQL, via `public.ads_details`. Les lectures publiques excluent les annonces retirées et les auteurs bannis ou désactivés.

## GET /auth/me

Utilise le cookie de session existant pour identifier le compte connecté.
`200` : `{ "user": { "id": 18, "username": "JoelTestDemo", "role": "PLAYER" } }`.
Aucun email ni mot de passe n'est renvoyé. Réponse non mise en cache (`no-store`).
`401 AUTH_REQUIRED` : session absente, expirée, révoquée ou compte bloqué.
`503` : authentification non configurée ou service indisponible.
Sur l'accueil, le pseudo remplace « Se connecter » et mène au profil.

## GET /health

Vérifie aussi la connexion PostgreSQL : `200` avec `{ "status": "OK", "timestamp": "..." }`.
Une connexion indisponible renvoie `503`. Aucun mot de passe ni détail SQL dans la réponse.

## GET /ads

`200` : tableau JSON, ordonné par date puis ID décroissants, `[]` si aucune annonce.
Chaque objet contient les mêmes champs que le détail :

```json
{
  "id": 1,
  "club_id": 1,
  "club": "FC Hégenheim",
  "team_id": 1,
  "team": "Équipe R3",
  "division": "R3",
  "title": "Recherche de joueur",
  "short_description": "Résumé de l’annonce",
  "position": "Gardien",
  "preferred_foot": null,
  "requirements": "Qualités recherchées",
  "contract": "À préciser",
  "work_time": "À préciser",
  "salary": "À préciser",
  "location": "Hégenheim",
  "description": "Description complète",
  "missions": "Missions du joueur",
  "created_at": "2026-10-08T10:00:00.000Z"
}
```

Exemple de forme, les titres et IDs réels dépendent de la base.
Les champs facultatifs peuvent être `null`.
Les emails, mots de passe et candidatures ne sont jamais inclus dans cette lecture.

## GET /ads/:id

`200` : un objet de la forme ci-dessus.
`400` : ID invalide ; `404` : ID valide mais annonce absente.
La requête SQL utilise `$1`, pas une concaténation de l’ID fourni.

## POST /applications

Route existante documentée, maintenant reliée à PostgreSQL ; aucun formulaire ajouté au front.
Envoyer `Content-Type: application/json` :

```json
{
  "ad_id": 1,
  "name": "Prénom Nom",
  "email": "joueur@example.invalid",
  "phone": "+33 600 000 000",
  "message": "Je souhaite rejoindre cette équipe."
}
```

`ad_id`, `name` et `email` sont obligatoires ; `phone` et `message` sont facultatifs.
Longueurs maximales : nom 200, email 255, téléphone 30, message 2000.
Aucun `user_id` ou `player_id` à inventer : cette route utilise la candidature sans compte
prévue dans le schéma SQL. Les autres propriétés ne sont pas enregistrées.

- `201` : `{ "id": 4, "created_at": "..." }`, après insertion effective.
- `400` : champs ou JSON invalides.
- `404` : annonce absente.
- `409` : cet email a déjà candidaté à cette annonce (casse/espaces ignorés).
- `413` : corps trop volumineux.
- `415` : format autre que JSON.
- `503` : connexion PostgreSQL indisponible ; `500` : autre erreur serveur.

Les erreurs ont la forme `{ "error": "Message lisible" }`.
La liste des candidatures et leurs coordonnées n’est pas exposée par une route publique.

## Postes multiples du joueur : POST /auth/register

Le formulaire de Thomas envoie `profile.positions` a la place de l'ancien champ `profile.position`.
Ce changement concerne le profil joueur uniquement ; `ads.position` reste inchange.

```json
{
  "email": "joueur@example.com",
  "username": "LionelTest",
  "password": "Une longue phrase pour mon compte !",
  "role": "PLAYER",
  "profile": {
    "first_name": "Lionel",
    "last_name": "Dupont",
    "positions": ["GOALKEEPER", "CENTRE_BACK"]
  }
}
```

- Facultatif : cle absente, `null` ou `[]` sont enregistres comme `[]`.
- Sinon : tableau de textes, maximum 14 elements, aucun doublon.
- Chaque code doit etre exact, en majuscules ; aucune conversion silencieuse des nouvelles inscriptions.
- Un texte seul, une valeur inconnue, un element null ou un tableau imbrique est refuse.
- L'ancien champ `profile.position` et les postes sur un profil CLUB sont refuses.
- Succes : `201`, avec `profile.positions` dans la reponse.
- Erreur : `400`, `code: VALIDATION_ERROR` et `fields["profile.positions"]` avec un message en francais.
- Les autres regles d'inscription restent inchangees (email, pseudo, mot de passe, role, transaction).

Codes autorises :
```text
GOALKEEPER
CENTRE_BACK
RIGHT_BACK
LEFT_BACK
RIGHT_WING_BACK
LEFT_WING_BACK
DEFENSIVE_MIDFIELDER
CENTRAL_MIDFIELDER
ATTACKING_MIDFIELDER
RIGHT_MIDFIELDER
LEFT_MIDFIELDER
RIGHT_WINGER
LEFT_WINGER
STRIKER
```

### GET /profile/me

Le compte connecte recoit sa fiche joueur avec `profile.positions`, toujours un tableau.
L'identifiant vient de la session. La route ne retourne aucun mot de passe.
L'affichage en francais des codes est gere par Thomas.
La route PATCH permet aussi de modifier sa fiche joueur avec l’objet `profile` décrit ci-dessous.

### Migration Neon

1. Executer `database/player-positions.sql` : ajout de `positions TEXT[] NOT NULL DEFAULT '{}'`,
   conversion des anciens textes francais/codes et controle SQL des valeurs.
2. Deployer le backend qui utilise `positions`.
3. Relancer la premiere migration, puis `database/player-positions-cleanup.sql`.
   Seule l'ancienne colonne du profil joueur est retiree, sans CASCADE.
   Une correspondance inconnue arrete la conversion ; completer la table de correspondance avant suppression.


## Modifier son pseudo : PATCH /profile/me

Envoyer `{"username":"Mon nouveau pseudo"}` avec le cookie de session et la même origine.
Le pseudo suit les règles de l'inscription (3 à 50 caractères) et doit être unique.
`200` renvoie le compte actualisé ; `400` pour un pseudo invalide ; `409 USERNAME_TAKEN` pour un doublon.
Le compte modifié est toujours celui de la session. Les autres champs du profil restent modifiables dans le même formulaire.


## Publication par un club

`GET /ads/options` : catalogues SQL `positions` (code, label) et `divisions` (code), départements du formulaire (Bas-Rhin, Haut-Rhin), pieds, tranches d’âge et niveaux d’expérience. Lecture publique, sans données personnelles.

`POST /ads` : compte CLUB connecté, actif et associé à son club ; cookie de session et origine autorisée obligatoires. Le serveur fixe l’auteur et le club depuis la session. Aucun identifiant d’auteur n’est accepté dans le JSON.

```json
{
  "city": "Colmar",
  "department": "Haut-Rhin",
  "positions": ["STRIKER", "RIGHT_WINGER"],
  "division_code": "R2",
  "description": "Notre club recherche un buteur pour la prochaine saison.",
  "preferred_foot": "Deux pieds",
  "salary": "Frais de déplacement remboursés"
}
```

Obligatoires : ville (100 caractères), département, 1 à 14 postes distincts, division et description (5 000 caractères). Les codes sont validés et vérifiés dans les catalogues SQL.
Facultatifs : `preferred_foot` (Droit, Gauche, Deux pieds, Indifférent ou null), `salary` (100 caractères), `age_range`, `experience_level`, `trial_possible` (booléen ou null), `additional_info` (2 000 caractères). Les choix exacts viennent de `/ads/options`.
Le validateur existant conserve les six départements déjà autorisés ; le nouveau formulaire présente uniquement les deux départements alsaciens.

`201` : `{id, title, created_at}` et en-tête Location `/ads/:id`. Le titre est généré depuis le nom du club. L’annonce et ses postes sont enregistrés dans une seule transaction, sans équipe obligatoire.
`400 VALIDATION_ERROR` : erreurs françaises dans `fields` ; `401` : session requise ; `403` : compte/origine non autorisé ; `415` : JSON requis ; `413` : corps trop volumineux ; `503` : service indisponible. Le formulaire bloque les doubles clics pendant l’envoi et reste fermé après une publication réussie.

## Modification de sa fiche : PATCH /profile/me

Le corps peut contenir `username`, `photo_url`, `biography`, `phone`, `location`, les trois booléens de visibilité et, pour un joueur, un objet `profile` partiel :

```json
{
  "biography": "Ma présentation personnelle.",
  "profile": {
    "positions": ["GOALKEEPER", "STRIKER"],
    "preferred_foot": "BOTH",
    "current_club": "Mon club",
    "past_clubs": "Club A\nClub B",
    "experience": "Trois saisons en régional.",
    "level": "R2"
  }
}
```

`profile.positions` : tableau de 14 codes autorisés maximum, sans doublon (`[]` ou null pour effacer). `preferred_foot` : RIGHT, LEFT, BOTH ou null. `current_club` : 150 caractères ; `past_clubs` et `experience` : 2 000 ; `level` : 100. Les champs absents sont conservés.
`photo_url` : adresse HTTPS sans identifiants, chemin local commençant par `/`, ou chaîne vide pour revenir à l’avatar par défaut ; 2 000 caractères maximum. Aucun téléversement de fichier.
La biographie sert aussi de présentation personnelle : aucune nouvelle colonne.

L’identifiant vient exclusivement de la session. Les champs non autorisés, dont `id`, `user_id`, rôle et mot de passe, sont refusés. Une fiche joueur ne peut pas être modifiée par un compte club. La mise à jour du compte et de la fiche est atomique ; un conflit ou une erreur annule tout.
`200` : `{message, user, profile}` immédiatement actualisés ; `400 INVALID_FIELD` : `field` et `message` ; `409 USERNAME_TAKEN` : pseudo occupé ; `401/403` : accès refusé ; `503` : service indisponible.

Pages : `/publier.html`, `/profile.html` et `/a-propos.html`. Les fonctions de messagerie, profils publics, calendriers, compositions et statistiques décrites dans À propos sont des projets futurs, pas des API disponibles.

Vérifications locales : `npm test` (API et build), `npm run test:registration`, `npm run test:profile`, `npm run test:ads` et `npm run test:admin`. Les tests de profil/publication utilisent une base isolée, sans écriture sur Neon.
