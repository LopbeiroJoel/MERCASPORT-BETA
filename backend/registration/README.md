# Inscription joueur / club

`POST /auth/register` est raccorde au serveur principal. L'inscription cree le
compte, le profil et sa fiche compatible `players`/`clubs` dans une transaction.
Le mot de passe est hashe avec Argon2id. Aucun e-mail ni session n'est cree ici.

## Installation

```bash
npm ci
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f database/registration.sql
npm start
```

Sur une nouvelle base, importer `database/schema.sql` avant `registration.sql`.
Le seed est facultatif, reserve aux donnees de demonstration ; l'importer avant
la migration et ne pas le relancer sur la production. La migration est relancable
et n'efface pas les comptes. Un conflit d'anciens pseudos/e-mails annule la migration.
Le backend doit posseder les droits sur les nouvelles tables de la migration.

## Pour le front

Envoyer `Content-Type: application/json`, avec exactement ces cinq champs :

```json
{
  "email": "joueur@example.com",
  "username": "JoueurExemple",
  "password": "Une longue phrase pour mon compte !",
  "role": "PLAYER",
  "profile": { "first_name": "Alex", "last_name": "Exemple" }
}
```

- `email` : valide, 254 caracteres maximum, unique sans distinction de casse.
- `username` : 3 a 50 caracteres, lettres/chiffres/espaces/point/tiret/apostrophe/underscore,
  unique sans distinction de casse.
- `password` : 15 a 128 caracteres, 512 octets maximum. Ne pas enlever ses espaces.
- `role` : `PLAYER` ou `CLUB` uniquement.
- Joueur : `first_name` et `last_name` obligatoires (100 caracteres chacun).
  Facultatifs : `birth_date` (AAAA-MM-JJ non future), `positions` (tableau de 15 codes maximum sans doublon),
  `preferred_foot` (`RIGHT`/`LEFT`/`BOTH`), `height_cm` (entier 100-250),
  `current_club` (150). Omettre les champs vides ou envoyer `null`.
- Club : `profile` contient `name` (150) et `city` (100) obligatoires,
  `divisions` facultatif (100). Utiliser `role: "CLUB"`.
- Ne pas envoyer d'identifiant, de hash, de statut ni de confirmation du mot de passe.

```js
const response = await fetch('/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(formulaire)
});
const resultat = await response.json();
// 201 : afficher un succes et proposer la connexion.
// Sinon : afficher resultat.error et resultat.fields, si present.
```

En local, ouvrir le front via `http://localhost:3000` (meme origine que l'API).
Apres deploiement : `https://mercasport.vercel.app/auth/register`. Un front separe
necessite un proxy ou une configuration CORS par la personne qui integre le back.
`DATABASE_URL` reste prive, uniquement dans le backend.

## Reponses

| HTTP | Signification |
|---|---|
| 201 | `{ message, user, profile }` ; compte et profil crees, `is_verified: false` |
| 400 | Informations invalides ; erreurs par champ dans `fields` |
| 409 | E-mail ou pseudo deja utilise |
| 413 / 415 | JSON de plus de 8 Ko / mauvais Content-Type |
| 429 | 10 tentatives valides au maximum par IP en 15 minutes ; `Retry-After: 900` |
| 503 | Base indisponible ou deux hashes deja en cours ; reessayer plus tard |
| 500 | Erreur interne ; aucun detail SQL expose |

Les compteurs anti-abus sont partages dans PostgreSQL, pas seulement en memoire.
Sous Vercel, l'IP vient de l'en-tete fourni par la plateforme ; en local les
en-tetes d'IP du client sont ignores. Reference :
[en-tetes Vercel](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for).

## Tests

```bash
npm run test:registration
npm run build
```

La suite utilise PostgreSQL embarque jetable et ne contacte pas Neon. Elle teste
le serveur integre : joueur, club, doublons, concurrence, rollback, hashage,
erreurs, limitation des tentatives, annonces et candidature.
