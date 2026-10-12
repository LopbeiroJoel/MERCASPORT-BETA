# API MercaSport

Le front et l’API partagent la même origine : `http://localhost:3000` en local,
le domaine du projet sur Vercel. Les appels navigateur utilisent `/ads` et `/ads/:id`.
Les annonces viennent de PostgreSQL, via `public.ads_details` ; aucun filtre de statut.

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
- Sinon : tableau de textes, maximum 15 elements, aucun doublon.
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
SECOND_STRIKER
CENTRE_FORWARD
```

### GET /profile/me

Le compte connecte recoit sa fiche joueur avec `profile.positions`, toujours un tableau.
L'identifiant vient de la session. La route ne retourne aucun mot de passe.
L'affichage en francais des codes est gere par Thomas.
La route PATCH existante conserve ses six champs communs : cette modification n'ajoute pas l'edition des postes.

### Migration Neon

1. Executer `database/player-positions.sql` : ajout de `positions TEXT[] NOT NULL DEFAULT '{}'`,
   conversion des anciens textes francais/codes et controle SQL des valeurs.
2. Deployer le backend qui utilise `positions`.
3. Relancer la premiere migration, puis `database/player-positions-cleanup.sql`.
   Seule l'ancienne colonne du profil joueur est retiree, sans CASCADE.
   Une correspondance inconnue arrete la conversion ; completer la table de correspondance avant suppression.
