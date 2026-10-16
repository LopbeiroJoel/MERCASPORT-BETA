# Mes repères pour l’oral

Le code est synchronisé avec le `main` récupéré le 16 octobre 2026.
Les ajouts de cette étape sont des commentaires : ils ne changent ni les routes ni les règles SQL.
Chercher **REPERE ORAL** dans VS Code pour retrouver les débuts de fichiers.

Le Google Doc donne les explications longues :
https://docs.google.com/document/d/1kKyzjGp8_AjunmxzXtSlZozY674Rs-0xeMh4Ox6sKm8/edit

## L’ordre dans lequel j’ouvre le code

| Ce que je veux expliquer | Le fichier à ouvrir |
| --- | --- |
| Le démarrage et le trajet d’une requête | `server.js`, puis `backend/app.js` |
| La connexion de Node à PostgreSQL/Neon | `backend/db.js` |
| Les tables et leurs liens au départ | `database/schema.sql` |
| Les profils et les champs ajoutés ensuite | `database/registration.sql`, `profile.sql`, `profile-fields.sql` |
| Les catalogues de postes/divisions | `database/positions.sql`, `divisions.sql` |
| La conversion des anciens postes | `database/player-positions.sql` et son nettoyage |
| Les annonces sans équipe et multipostes | `database/ads-recruitment.sql` |
| Les candidatures sans équipe obligatoire | `database/ads-applications.sql` |
| L’inscription complète | `backend/registration/router.js` |
| Les règles et le mot de passe | `backend/registration/validation.js`, `password.js` |
| Le login et la session | `backend/authentication/router.js`, `session.js` |
| Le logout | `backend/authentication/logout-router.js` |
| Mon compte et mon nouveau pseudo | `backend/profile.js`, `frontend/js/profile.mjs` |
| Le pseudo du bandeau | `frontend/js/account.mjs` |
| Les droits admin | `backend/admin/permissions.js` |
| Les chemins du panel | `backend/admin/router.js` |
| Les comptes/fiches/ressources/annonces du panel | `backend/admin/users.js`, `profiles.js`, `resources.js`, `ads.js` |
| La transaction et les paramètres SQL | `backend/admin/helpers.js` |
| La suppression définitive | `backend/admin/deletion.js` |
| Ce que les boutons du panel envoient | `frontend/js/admin.mjs` |
| La préparation Vercel | `scripts/build.js` |
| Les preuves par les tests | `tests/`, `backend/registration/tests/` |

## Les mots qui reviennent dans les commentaires

- `req.params.id` : l’ID dans `/ads/7` ; `req.query` : ce qui suit `?` ; `req.body` : le JSON envoyé.
- `pool.query` : une requête SQL seule. `pool.connect` : un client gardé pour une transaction complète.
- `$1` : une valeur SQL fournie séparément du texte de la requête.
- `result.rows` : les lignes revenues de PostgreSQL ; `rows[0]` : la première.
- `BEGIN`, `COMMIT`, `ROLLBACK` : commencer, valider ou annuler toutes les écritures ensemble.
- `release` : rendre le client au Pool, même après une erreur.
- `FOREIGN KEY` : un lien vers une ligne existante ; `CASCADE` : une suppression qui suit ce lien.
- `LEFT JOIN` : garder la ligne de gauche même sans correspondance à droite.
- `401` : pas de session valide ; `403` : refus d’accès ; `404` : pas de ressource ; `409` : conflit.

## Les points sur lesquels je ne me trompe pas

- Pas de refresh token ni de `/auth/refresh`. La session expire au bout de 30 minutes par défaut.
- Le cookie contient un JWT signé, pas chiffré. La ligne SQL `auth_sessions` permet la révocation.
- L’inscription crée le compte et redirige vers l’accueil ; elle ne connecte pas automatiquement.
- `/admin.html` est la page du panel. `/admin/me` est une API JSON protégée.
- Les DELETE de comptes/annonces sont définitifs sur main ; bannir reste un UPDATE de statut.
- `schema.sql` est le schéma de départ avec sa migration historique, pas un export du Neon actuel.
- Je ne relance pas tout le SQL sur Neon pour réviser. Un script de migration n’est pas une simple lecture.
- Le module complet des clubs `POST /ads` est resté sur la branche locale `annonces` (`a705077`). Je ne prétends pas qu’il est livré sur main.
- Le main a `POST /applications` avec `ad_id` dans le JSON, pas exactement `/ads/:id/applications` demandé par le PDF.
- Le main n’a pas la route exacte `/companies/:id/ads` du PDF. Je connais cet écart.
- Le dernier pull a remplacé `frontend/js/app.mjs` par `frontend/js/script.js` pour l’accueil. C’est le fichier récent de Thomas, déjà commenté ; je ne revendique pas son travail.
- Le design et certains formulaires sont le travail des collègues. Mes commentaires expliquent le branchement du backend sur leurs pages.

## Ouvrir le bon dossier dans VS Code

```bash
cd ~/Mois1/MercaSport-beta-annonces
code .
```

Les autres copies `MercaSport-beta` ou `MercaSport-beta-admin` peuvent contenir du travail local ancien.
Elles ne sont pas écrasées pour récupérer `main` : c’est ce dossier synchronisé qui sert de référence ici.


## Vérifications faites après les annotations

- Les 35 fichiers JavaScript modifiés ont exactement le même arbre syntaxique avant/après, commentaires exclus.
- Les 49 fichiers déjà présents gardent toutes leurs lignes d’origine ; seules des lignes de commentaires et d’espacement sont ajoutées.
- 23 tests de profil, 18 tests d’inscription et 32 tests admin passent : 73 tests réussis.
- La suite SQL historique échoue sur son contrôle d’absence de colonne `status` dans le scénario de migration.
- La suite API/build cherche encore `frontend/js/app.mjs`, alors que le dernier main a remplacé ce fichier par `script.js` ; cela fait aussi échouer les tests qui dépendent du premier résultat.
- Ces deux échecs ont été reproduits dans une copie temporaire de HEAD sans annotations : ils ne sont pas causés par les commentaires.
- Le Google Doc décrivait les 79 tests réussis sur l’ancien commit `13cb3f9`. Après le pull du front récent, je cite le bilan ci-dessus plutôt que prétendre que toutes les suites sont vertes.
- Aucune migration n’a été lancée dans Neon et aucune donnée réelle n’a été modifiée pour cette étape.
