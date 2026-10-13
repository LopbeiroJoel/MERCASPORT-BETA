# Panel administrateur MercaSport — V1 simple

## Ce qui fonctionne

- Connexion avec le compte existant : aucun second mot de passe administrateur.
- Un seul droit administratif : ADMIN, stocké dans `admin_permissions`.
- Recherche des utilisateurs par ID, pseudo, e-mail ou nom du club (50 résultats maximum).
- Recherche des annonces par ID, titre, auteur ou club (50 résultats maximum).
- Bannissement d'un joueur ou club après confirmation, sans motif obligatoire.
- Suppression logique d'une annonce après confirmation, sans motif obligatoire.

## Ouvrir le panel

En local : `http://localhost:3000/admin.html`.

Sur BETA : `https://mercasport-beta.vercel.app/admin.html`.

Utiliser le lien Connexion, se connecter avec son e-mail et son mot de passe, puis revenir au panel dans le même navigateur. Le compte doit être ACTIVE et avoir une ligne ADMIN active dans `admin_permissions`. Ne jamais écrire le mot de passe dans Git.

La page ne contient aucun CSS ni bibliothèque supplémentaire. Elle charge ses données seulement après validation de l'accès par le backend. Connaître l'adresse de la page ne donne pas accès aux données.

## Bannir un utilisateur

1. Rechercher le compte et vérifier son ID et son e-mail.
2. Cliquer sur Bannir et confirmer.
3. Le backend passe le statut à BANNED et conserve l'ancien statut.
4. Il révoque les sessions du compte. Les anciennes sessions et nouvelles connexions sont refusées.
5. Les annonces de ce compte ne sont plus accessibles au public et ne reçoivent plus de candidatures.

Le compte reste dans Neon. Les comptes rattachés à `admin_permissions`, même désactivés, et les comptes de rôle ADMIN sont protégés de cette route. Le propre compte de l'administrateur ne peut pas être banni ici.

## Supprimer une annonce

1. Rechercher et vérifier l'annonce.
2. Cliquer sur Supprimer et confirmer.
3. Son statut devient DELETED, avec une date de suppression.
4. L'annonce disparaît de la liste publique, son accès direct renvoie 404 et les candidatures sont refusées.

L'annonce reste consultable dans le panel ; sa ligne SQL n'est pas effacée.

## Fichiers et rôle

| Fichier | Rôle |
|---|---|
| `frontend/admin.html` | Page et tableaux sans CSS. |
| `frontend/js/admin.mjs` | Appels aux API, recherches, confirmations et messages. |
| `backend/admin/permissions.js` | Vérification de la session, du statut ACTIVE et des droits ADMIN actifs à chaque requête. |
| `backend/admin/router.js` | API de recherche, bannissement et suppression. |
| `backend/authentication/router.js` | Refus des connexions des comptes BANNED ou DISABLED. |
| `backend/authentication/session.js` | Refus de leurs sessions existantes. |
| `backend/app.js` | Branchement du routeur et filtre public sur annonces et candidatures. |
| `database/admin.sql` | Migration additive, réexécutable, sans attribution automatique de droits. |
| `tests/admin.test.js` | Tests dans PostgreSQL embarqué jetable, sans connexion à Neon. |

Sur une nouvelle base, appliquer les migrations existantes, puis `database/admin.sql`. Ce fichier fournit également `ads.author_id` et le statut des comptes si absents. `schema.sql` ne supprime plus `ads.status`.

## API et champs

| Méthode | Route | Données |
|---|---|---|
| GET | `/admin/me` | Identité de l'administrateur connecté. |
| GET | `/admin/administrators` | Liste utilisée pour protéger les comptes administrateurs. |
| GET | `/admin/users?search=Joel` | Recherche utilisateurs ; `search` facultatif, 100 caractères maximum. |
| GET | `/admin/ads?search=Gardien` | Recherche annonces ; même limite. |
| POST | `/admin/users/18/ban` | JSON `{"confirm":true}`. |
| POST | `/admin/ads/28/delete` | JSON `{"confirm":true}`. |

Ces ID sont des exemples : ne pas utiliser un vrai compte ou une vraie annonce pour tester une sanction. Toutes les routes exigent une session ADMIN. Les POST exigent du JSON et une origine autorisée. Le navigateur transmet le cookie HttpOnly ; le frontend ne lit pas le token.

Codes usuels : 401 sans session valide, 403 droits insuffisants ou compte protégé, 400 saisie/confirmation invalide, 404 cible absente, 409 sanction déjà appliquée, 503 opération indisponible.

## Cohérence et sécurité

Les sanctions et leur trace technique dans `admin_actions` sont dans une transaction : une erreur annule toute la modification. Aucun écran d'historique n'est ajouté. Aucun motif n'est demandé.

Les requêtes SQL sont paramétrées. Les résultats sont affichés avec `textContent`, sans interpréter les noms ou titres comme du HTML. L'activation des droits et le rôle sont contrôlés côté serveur, pas seulement par les boutons.

## Tests

`npm run test:admin` vérifie les accès refusés, les recherches, la confirmation, la protection des admins, les sanctions, la révocation des sessions, le masquage public, le refus des candidatures et l'annulation en cas d'erreur SQL. Les inscriptions et profils disposent aussi de `npm run test:registration` et `npm run test:profile`.

Pour tester l'interface : lancer `npm start`, se connecter, ouvrir `admin.html`, rechercher un compte et une annonce. Annuler les fenêtres de confirmation permet de vérifier les boutons sans sanctionner personne.

## Limites de cette V1

Pas de bouton de débannissement, pas d'écran d'historique, pas de statistiques ni de gestion des droits depuis le panel. Les droits administrateurs restent gérés dans Neon. La protection du dernier ADMIN lors d'une modification SQL manuelle et la double authentification ne sont pas implémentées. La pagination n'est pas prévue au-delà des 50 résultats affichés.
