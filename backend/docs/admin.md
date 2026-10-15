# API admin MercaSport

Le panel reste un HTML simple sans CSS. Les onglets Joueurs et Clubs séparent les comptes
avec un filtre côté serveur. Le bouton Modifier le compte ouvre les formulaires de pseudo,
e-mail, coordonnées, fiche, statut, vérification de l'adresse et nouveau mot de passe.
Chaque rubrique possède son propre bouton Enregistrer. Le bouton Modifier l'annonce ouvre
un formulaire pour les champs de recrutement. Les autres opérations CRUD restent accessibles
par l'API, sans nouvel écran ajouté pour les équipes, candidatures ou catalogues.

## Connexion

Utiliser POST /auth/login et le cookie de session habituel. Chaque route /admin exige
un compte ACTIVE et une permission ADMIN active. Pour les écritures, Origin doit être
égal à APP_ORIGIN. POST, PATCH et PUT exigent Content-Type: application/json.
Les données JSON sont limitées à 8 Ko pour PATCH /admin/users/:id et à 16 Ko pour
les nouvelles routes. Aucune nouvelle bibliothèque ni aucun mot de passe dans Git.

## Routes

| Ressource | Liste | Détail | Créer | Modifier | Supprimer |
|---|---|---|---|---|---|
| Comptes | GET /admin/users | GET /admin/users/:id | POST /admin/users | PATCH /admin/users/:id | DELETE /admin/users/:id |
| Profils | Avec les comptes | GET /admin/users/:id/profile | POST /admin/users/:id/profile | PATCH /admin/users/:id/profile | DELETE /admin/users/:id/profile |
| Clubs | GET /admin/clubs | GET /admin/clubs/:id | POST /admin/clubs | PATCH /admin/clubs/:id | DELETE /admin/clubs/:id |
| Équipes | GET /admin/teams | GET /admin/teams/:id | POST /admin/teams | PATCH /admin/teams/:id | DELETE /admin/teams/:id |
| Annonces | GET /admin/ads | GET /admin/ads/:id | POST /admin/ads | PATCH /admin/ads/:id | DELETE /admin/ads/:id |
| Candidatures | GET /admin/applications | GET /admin/applications/:id | POST /admin/applications | PATCH /admin/applications/:id | DELETE /admin/applications/:id |
| Postes | GET /admin/positions | GET /admin/positions/:code | POST /admin/positions | PATCH /admin/positions/:code | DELETE /admin/positions/:code |
| Divisions | GET /admin/divisions | GET /admin/divisions/:code | POST /admin/divisions | PATCH /admin/divisions/:code | DELETE /admin/divisions/:code |

Autres routes :

- GET /admin/me : identité de l'admin connecté.
- GET /admin/administrators : comptes ayant des droits administratifs.
- PATCH /admin/users/:id/status : {"status":"ACTIVE"}, ou PENDING, BANNED, DISABLED.
- PATCH /admin/users/:id/verification : {"is_verified":true} ou false, réservé aux admins.
- PUT /admin/users/:id/password : {"password":"Une longue phrase de remplacement !"}.
- PUT /admin/users/:id/profile : création ou modification du profil avec les données reçues.

Les anciennes routes POST /admin/users/:id/ban et POST /admin/ads/:id/delete restent
disponibles avec {"confirm":true} pour préserver le frontend actuel.
Préférer les nouvelles routes REST pour les nouveaux appels.

## Comptes et profils

POST /admin/users utilise le même JSON et les mêmes validations que /auth/register :

```json
{
  "username": "NouveauJoueur",
  "email": "joueur@example.com",
  "password": "Une longue phrase de test 2026 !",
  "role": "PLAYER",
  "profile": {
    "first_name": "Lionel",
    "last_name": "Test",
    "positions": ["STRIKER"]
  }
}
```

Pour CLUB, profile contient name, city et divisions (facultatif).
Le compte est créé PENDING, sans droits administratifs ; activer ensuite via la route status.
La création du compte et du profil est atomique. Le mot de passe est haché avec la fonction
existante. Ni mot de passe ni hash ne sont renvoyés.

PATCH /admin/users/:id accepte uniquement username et email. Les champs absents sont conservés.
Changer l'e-mail remet is_verified à false et révoque les sessions du compte cible.
Changer le mot de passe révoque également ses sessions. Pour l'admin lui-même, cela implique
de se reconnecter. Ces actions ne changent pas ses droits administratifs.

La route profile accepte les informations communes : photo_url, biography, phone, location,
email_visible, phone_visible, location_visible, ainsi que :

- PLAYER : first_name, last_name, birth_date, positions, preferred_foot (RIGHT/LEFT/BOTH),
  height_cm, current_club, past_clubs, experience, level.
- CLUB : name, city, divisions, description, general_info.

Les champs obligatoires restent obligatoires. Une URL de photo doit être HTTP(S) ou un chemin
local commençant par /. POST crée un profil absent, PATCH modifie un profil existant ;
PUT crée ou fusionne les informations du profil. Les tables historiques players et clubs
restent synchronisées, sans doublons. Les joueurs sont représentés par users + profil ;
pas de seconde API contradictoire pour la copie technique players.

Le rôle PLAYER/CLUB est fixé à la création : on ne convertit pas un joueur en club.
Les permissions admin ne sont pas attribuées via ces formulaires. Les sessions,
compteurs anti-abus et journaux internes ne sont pas des ressources métier à modifier librement.

## Clubs et équipes

POST /admin/clubs : {"name":"Nom","city":"Colmar","user_id":18,"divisions":"R3"}.
user_id est facultatif (club sans compte) ; s'il est fourni, le compte doit être CLUB et
ne pas déjà posséder un autre club. Le propriétaire est fixé à la création.
PATCH accepte name, city, divisions et synchronise club_profiles lorsque le club a un compte.

POST /admin/teams : {"club_id":1,"name":"Équipe 1","division":"R3","category":"Senior"}.
category vaut Senior par défaut. PATCH accepte ces mêmes champs. La division doit exister
dans le catalogue SQL. Un transfert d'équipe vers un autre club est refusé si elle a des annonces.

## Annonces

L'admin peut gérer les annonces de tous les propriétaires, y compris les consulter après suppression.
Exemple de création :

```json
{
  "author_id": 18,
  "city": "Colmar",
  "department": "Haut-Rhin",
  "positions": ["GOALKEEPER", "STRIKER"],
  "division_code": "R3",
  "description": "Nous recherchons des joueurs."
}
```

author_id est obligatoire à la création : compte PLAYER ou CLUB existant. Pour CLUB,
le club associé est trouvé par le backend. Aucune équipe obligatoire.
Les autres champs obligatoires sont city (100), description (5000), department,
positions (1 à 14, sans doublon) et division_code.
Départements : Bas-Rhin, Haut-Rhin, Moselle, Meurthe-et-Moselle, Meuse, Vosges.

Facultatifs : title (150, sinon généré), preferred_foot (Droit/Gauche/Deux pieds/Indifférent),
salary (100), age_range (UNDER_18/18_25/26_35/36_PLUS/ANY),
experience_level (BEGINNER/DEPARTMENTAL/REGIONAL/NATIONAL/ANY),
trial_possible (true/false/null), additional_info (2000).
Le texte peut contenir des retours à la ligne. Les champs facultatifs absents sont null.
PATCH est partiel et remplace toute la liste positions si elle est fournie.
L'auteur et le club propriétaire ne sont pas transférés par PATCH.
Les références SQL sont vérifiées ; annonce et postes sont sauvegardés ensemble.

## Candidatures

POST /admin/applications : {"ad_id":1,"name":"Prénom Nom","email":"joueur@example.com"}.
Facultatifs : player_id (id de players), phone (30), message (2000).
PATCH accepte ces mêmes champs. Une candidature doit référencer une annonce disponible.
L'adresse e-mail est normalisée ; les doublons pour une même annonce renvoient 409.
La suppression d'une candidature est définitive et ne supprime pas le compte joueur.

## Catalogues

Les 14 codes de postes convenus sont conservés, dont STRIKER = Buteur.
Les divisions restent D8 à D1, R3 à R1, N3 à N1.
POST permet de recréer un code connu retiré du catalogue, pas d'introduire un quinzième poste.
Poste : {"code":"RIGHT_WING_BACK","label":"Piston droit","sort_order":5}.
Division : {"code":"D8","sort_order":1}.
PATCH accepte label et sort_order pour les postes, sort_order pour les divisions.
Les codes sont immuables. sort_order est un entier positif unique (maximum 32767).
Un code utilisé par une annonce, une équipe ou un profil ne peut pas être supprimé.
Un poste retiré du catalogue est refusé aux nouvelles inscriptions et modifications de profils.

## Suppressions et statuts

- DELETE user : désactivation DISABLED et révocation des sessions. Les données restent en SQL.
- DELETE ad : statut DELETED et date, données et candidatures conservées.
- DELETE club/team/profile : suppression définitive seulement si les relations le permettent.
  Pas de cascade implicite sur les équipes, annonces ou candidatures ; sinon 409.
- DELETE application : suppression définitive de cette candidature uniquement.
- DELETE poste/division : suppression seulement si le code est inutilisé ; sinon 409.

Les comptes ayant des droits admin et le compte administrateur connecté sont protégés
des désactivations/bannissements par ces routes. Les changements de rôle ne sont pas exposés.

## Réponses et sécurité

200 lecture/modification, 201 création, 204 suppression sans corps ; 400 données invalides,
401 sans session, 403 droits/origine interdits, 404 ressource absente, 409 doublon ou dépendance,
413 JSON trop volumineux, 415 format incorrect, 503 service indisponible.
Les nouvelles erreurs ont la forme {"code":"..."}, éventuellement avec fields pour la validation.
Aucun détail SQL, hash ou cookie n'est renvoyé.

Toutes les écritures nouvelles revérifient les droits admin dans une transaction.
Les valeurs SQL sont paramétrées. Les noms de table/colonnes proviennent de constantes du code.
Les listes clubs/teams/applications/positions/divisions acceptent limit (1 à 100) et offset.
Les recherches users/ads conservent search et leur limite historique de 50 résultats.
GET /admin/users accepte aussi role=PLAYER ou role=CLUB, appliqué avant LIMIT 50.
Sans role, les deux types sont recherchés. Les autres valeurs et paramètres role répétés sont refusés.
Les réponses ne sont pas mises en cache.

## Organisation du code

- router.js : accès, routes historiques et branchement des nouvelles routes.
- permissions.js : vérification de la session et des droits ADMIN actifs.
- users.js : création, statut, mot de passe et désactivation.
- user-validation.js : validation du pseudo et de l'e-mail pour PATCH.
- profiles.js : profils et synchronisation des anciennes tables.
- resources.js : clubs, équipes, candidatures et catalogues.
- ads.js : annonces de tous les propriétaires.
- helpers.js : petites fonctions de validation, SQL et transaction, sans framework supplémentaire.

## SQL et déploiement

Sur une base existante, ne pas exécuter seed.sql pour installer cette fonctionnalité.
Les migrations requises, dans l'ordre : registration.sql, profile.sql, profile-fields.sql,
player-positions.sql, admin.sql, positions.sql, divisions.sql, ads-recruitment.sql,
ads-applications.sql. Vérifier celles qui ont déjà été appliquées.

La migration ads-applications.sql permet de candidater aux annonces sans équipe.
Ces migrations sont fournies et testées localement : le push Git ne les exécute pas sur Neon.
Les variables privées habituelles sont DATABASE_URL, AUTH_SECRET et APP_ORIGIN.

## Tests

```bash
npm run test:admin
npm run test:registration
npm run test:profile
npm test
```

Les tests admin utilisent PostgreSQL embarqué jetable, sans .env ni Neon. Ils couvrent les
accès, CRUD, validations, références, doublons, profils synchronisés, mots de passe hachés,
révocation de session, refus de cascades et rollback. npm test vérifie les anciennes API
sur un cluster PostgreSQL local temporaire.
