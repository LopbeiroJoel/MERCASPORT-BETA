# Développement de la page Profil - Merca Sport

## PROF-01 - Préparer les fichiers

**But :** préparer une seule page Profil, commune aux joueurs et aux clubs.

**Fichiers préparés :**

| Fichier | À quoi il sert |
|---|---|
| `frontend/profile.html` | Structure de la page et emplacement des informations. |
| `frontend/js/profile.mjs` | Récupère le compte connecté et adapte le titre Joueur/Club. |
| `frontend/css/style.css` | Feuille existante conservée ; la mise en forme est confiée à la personne chargée du CSS. Aucun style ajouté pour ces étapes. |
| `frontend/assets/default-avatar.svg` | Image affichée tant qu'aucune photo personnelle n'est prévue. |
| `backend/profile.js` | Route privée qui renvoie l'identité du propriétaire du profil. |
| `database/profile.sql` | Prépare les sessions et les compteurs nécessaires à la connexion. |

**Principe :** nous gardons une seule page et une condition simple selon `PLAYER` ou `CLUB`.
Le HTML et ses classes sont conservés pour que la personne chargée du CSS puisse les mettre en forme.
Cette première étape affiche le pseudo, l'e-mail, l'identifiant et le type du compte.
Les fiches, la biographie, la photo personnalisée, les annonces et les modifications
seront ajoutées dans les étapes PROF-03 à PROF-10.

## PROF-02 - Identifier le compte connecté

**But :** savoir quel utilisateur consulte son profil et s'il est joueur ou club.

**Fonctionnement :**

1. La personne ouvre `login.html` et saisit son e-mail ou son pseudo, puis son mot de passe.
2. Le front envoie ces informations à `POST /auth/login`.
3. Le backend vérifie le mot de passe et crée une session enregistrée en base.
4. Le navigateur conserve un cookie de session protégé. Le JavaScript ne lit pas ce cookie.
5. La page Profil appelle `GET /profile/me` : le serveur reconnaît la session et renvoie le bon compte.
6. La même page affiche « Mon profil joueur » ou « Mon profil club » selon le rôle renvoyé par le serveur.

**Exemple de réponse de `/profile/me` :**

```json
{
  "user": {
    "id": 42,
    "username": "JoueurExemple",
    "email": "joueur@example.com",
    "role": "PLAYER"
  }
}
```

L'identifiant est illustratif. Le front ne choisit ni l'identifiant ni le rôle.
Une personne non connectée est renvoyée vers la connexion. Le bouton « Se déconnecter »
appelle `POST /auth/logout`, annule la session et revient à la page de connexion.
Les modules de connexion existants ont été réutilisés ; les anciennes routes annonces
et candidatures sont conservées.

**Sécurité de base :** mot de passe jamais stocké dans le navigateur, cookie HttpOnly,
protection contre les tentatives répétées, session de 30 minutes et données du profil
réservées au compte connecté. Les anciens mots de passe bcrypt restent compatibles.

## Installation et test

1. Lancer `npm ci` à la racine du projet.
2. Sur la base cible, appliquer `database/registration.sql`, puis `database/profile.sql`.
   Ces fichiers ajoutent les prérequis ; ils ne suppriment pas les comptes.
   Ne pas importer les données de démonstration dans la production.
3. Dans le `.env` privé, renseigner `DATABASE_URL`, `AUTH_SECRET` et `APP_ORIGIN`.
   Générer AUTH_SECRET avec `node -p "require('node:crypto').randomBytes(32).toString('hex')"`.
   Ne pas copier la valeur réelle de cette clé ni la chaîne Neon dans Google Docs ou Git.
4. En local, utiliser `APP_ORIGIN=http://localhost:3000`, lancer `npm start`,
   puis ouvrir `http://localhost:3000/login.html`. Utiliser la même adresse partout.
5. En production, APP_ORIGIN doit être l'origine HTTPS exacte du site.
   Le cookie utilise alors Secure et le préfixe `__Host-`.
   L'exception HTTP est réservée au PC de développement, jamais à Vercel.

Tester successivement un compte joueur et un compte club déjà inscrits : connexion,
bon pseudo, bon identifiant, bon rôle, actualisation de la page et déconnexion.
Sans configuration, la connexion et le profil répondent 503 ; les annonces restent accessibles.

Tests automatisés : `npm run test:profile` et `npm run test:registration`.
Ils utilisent une base PostgreSQL embarquée jetable, sans contacter Neon.
Validation réalisée avec Node.js 22 : 27 tests réussis (13 profil/connexion et
14 inscription). Le parcours a aussi été vérifié dans le navigateur : accès
anonyme renvoyé vers la connexion, profil joueur, profil club, actualisation et déconnexion.

**Branche de livraison :** `profile/setup-identity`.
L'application des prérequis dans Neon et le déploiement restent des étapes distinctes.
