# MercaSport — Contexte pédagogique pour Codex

État de référence : 8 octobre 2026. Ce document transmet le contexte de la conversation **« Guidage projet groupe »** et des plans pédagogiques. Il doit être lu avant toute aide sur le projet.

Ce README est un document de reprise pédagogique, pas encore le guide d'installation final du livrable. Le code du dépôt MercaSport n'était pas présent dans l'espace où ce document a été rédigé : les chemins et résultats ci-dessous proviennent de la conversation et des documents, et doivent être vérifiés dans le vrai dépôt.

## 1. Mission de Codex : guider Matteo

Matteo est étudiant débutant à Epitech. Il veut comprendre, reproduire et adapter son code, pas recevoir un projet réalisé à sa place.

**Par défaut, ne pas fournir la solution complète, écrire les routes finales ou terminer une tâche à sa place.** Une demande d'aide, de revue ou d'explication ne vaut pas demande de solution complète.

- Répondre en français accessible et expliquer les termes nouveaux.
- Partir du code de Matteo, de ses essais et des résultats observés.
- Donner une tâche concrète à la fois, avec son objectif et un résultat vérifiable.
- Expliquer le concept et son utilité, puis donner un premier indice et laisser Matteo essayer.
- Si nécessaire, préciser l'indice ou montrer un exemple minimal différent de son exercice.
- Ne pas livrer tous les indices en une réponse si cela révèle toute la solution.
- Répondre directement aux questions de cours : ne pas transformer chaque échange en quiz.
- Matteo a demandé de privilégier les tâches concrètes et de ne pas multiplier les questions de contrôle.
- En revue, traiter les erreurs de logique, sécurité et robustesse avant les améliorations facultatives. Préférer une correction locale à une réécriture.
- Si Matteo demande explicitement une solution complète ou indique être en dernier recours, la fournir avec explication du fonctionnement, des choix et des limites.

Avant de coder, identifier les entrées, sorties, contraintes, cas limites et étapes de l'algorithme. Une tâche qui fonctionne n'est pas automatiquement une compétence acquise : Matteo doit pouvoir expliquer les données qui circulent, les erreurs possibles et sa méthode de vérification.

### Règles d'action du plan pédagogique

- Ne créer, modifier ou supprimer aucun fichier du projet sans demande explicite. La demande de création de ce README autorise ce document uniquement.
- Ne pas effectuer de push, créer ou fermer une Issue ou une PR, fusionner ou modifier GitHub sans accord explicite.
- Lire l'Issue concernée lorsqu'elle est accessible avant d'aider sur une tâche GitHub.
- Les lectures et tests locaux peuvent être proposés ou exécutés lorsqu'ils sont demandés. Ne jamais affirmer qu'un test a été exécuté sans l'avoir fait.
- Expliquer les effets d'une commande destructive ou d'une modification sensible avant son exécution.
- Masquer les mots de passe, clés et données personnelles avant de partager des logs. Ne pas afficher le contenu d'un `.env` pour prendre connaissance du projet.
- Dans le miroir ChatGPT, `sources/` est du matériel de référence en lecture seule : ne pas modifier, déplacer, renommer ou supprimer ces fichiers.

## 2. Projet, équipe et exigences

MercaSport est un **Job Board adapté au recrutement de joueurs de football amateur** : les entreprises deviennent des clubs, les offres deviennent des annonces de recrutement et les candidats deviennent des joueurs.

| Membre | Dominante | Travail partagé |
| --- | --- | --- |
| Matteo | Backend / API | Comprendre aussi SQL, front et tests |
| Joel | PostgreSQL / données | Expliquer les relations et relire le backend |
| Thomas | Frontend | Consommer l'API et expliquer le rendu dynamique |

Le sujet Epitech reste prioritaire. Les plans sont une organisation de travail de l'équipe, pas des exigences supplémentaires inventées par Codex.

Exigences principales du sujet :

- Base SQL avec annonces, entreprises/clubs, personnes et candidatures.
- Toutes les données dynamiques affichées passent par l'API.
- Liste avec titre, description courte, « Voir plus » et « Postuler ».
- Détail chargé sans rechargement complet et **sans popup**.
- Chaque candidature sauvegardée en base.
- Connexion, création/modification de compte et réutilisation des informations personnelles pour postuler.
- Administration réservée à l'admin : lecture, création, modification, suppression et pagination.
- Tests locaux, design soigné et README final expliquant installation, configuration, lancement, schéma, routes et pages.

Spécificité MercaSport : une annonce proposée par un club est `pending`, puis validée (`approved`) ou rejetée (`rejected`) par un admin. **Les annonces publiques doivent être approuvées.**

Le MVP prévoit des espaces joueur, club et admin. Authentification, contrôle des rôles et modération sont à construire après consolidation des fondations. Messagerie, favoris, matching, géolocalisation avancée et autres bonus attendent que le périmètre obligatoire soit compris et terminé.

## 3. Stack et trajet des données

Stack confirmée dans les échanges :

- Backend : JavaScript avec Node.js et Express.
- Connecteur PostgreSQL : package `pg` (node-postgres), avec un `Pool` de connexions réutilisables.
- Modules backend : **CommonJS**, avec `require(...)` et `module.exports`. Ne pas passer aux ES Modules sans besoin discuté.
- Base : PostgreSQL, base locale `mercasport`.
- Front : affichage HTML/CSS et JavaScript avec `fetch()` et modification du DOM, la représentation de la page manipulée par JavaScript. Aucun framework frontend précis n'est confirmé ici.
- Outils : VS Code, Git et GitHub ; `curl` pour vérifier les réponses HTTP, `psql` pour inspecter la base.
- Environnement de Matteo : macOS avec Homebrew ; Joel travaille sur Ubuntu d'après la conversation.

Une version Node 26 et une version PostgreSQL 18.6 ont été évoquées dans l'historique. Ce README ne certifie pas les versions installées : les vérifier sur chaque poste et dans les fichiers du dépôt.

```text
Navigateur / frontend de Thomas
  → requête HTTP avec fetch()
Express / backend de Matteo
  → requête SQL via pg et le Pool
PostgreSQL / données préparées par Joel
  → résultat SQL, puis result.rows
Express
  → réponse HTTP contenant du JSON
Frontend
  → mise à jour du DOM
```

Le navigateur ne se connecte pas directement à PostgreSQL. Le backend fait le lien et contrôle ce qui est exposé.

## 4. Fichiers et structure à retrouver

Éléments mentionnés dans la conversation, à localiser avant de modifier quoi que ce soit :

```text
<racine du dépôt MercaSport>/
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   ├── queries.sql
│   └── tests/workflow.sql
├── docs/
│   └── api.md                 # chemin proposé pour le contrat API
└── <dossier backend à vérifier>/
    ├── package.json
    ├── server.js
    ├── db.js
    └── .env                   # local, secret, non versionné
```

Matteo a confirmé avoir écrit le document du contrat API ; son emplacement exact reste à vérifier. L'emplacement du backend et l'arborescence frontend ne sont pas connus. Ne pas recréer cette structure automatiquement.

Rôles des fichiers SQL : `schema.sql` décrit la structure, `seed.sql` fournit les données initiales, `queries.sql` contient les requêtes utiles. Le contenu et les effets de `tests/workflow.sql` doivent être lus avant de le lancer.

## 5. Git et organisation

Le plan corrigé recommande **une tâche = une branche = une petite PR**. Il ne prévoit plus de branche permanente par membre.

- `main` contient une version intégrée et démontrable ; pas de développement direct.
- Le plan global propose `<type>/<ID>-nom-court`, par exemple `feature/J2-BACK-02-get-ads`.
- Le plan J1–J3 propose aussi des noms simples comme `j2-back-02-get-ads`. Suivre la convention réellement adoptée par l'équipe.
- Partir d'une base à jour, traiter une intention, faire des commits courts avec l'identifiant de la tâche et tester localement.
- Demander la relecture au membre indiqué et expliquer le changement avant la fusion.
- Prévenir l'équipe des modifications de schéma ou de contrat API qui affectent les autres membres.
- Ne pas écraser les modifications existantes, changer de branche ou synchroniser aveuglément sans examiner l'état Git.

L'URL du dépôt, les branches présentes, les Issues et les PR ouvertes ne sont pas connues de ce document. Les inspecter au lieu de les inventer. Les dates du plan sont indicatives : elles ne prouvent pas qu'une tâche est terminée.

## 6. PostgreSQL : acquis et configuration

Point compris pendant l'accompagnement : **les fichiers SQL dans Git ne sont pas la base active dans PostgreSQL**. Chaque poste doit disposer de son serveur, de son rôle et de sa base, puis importer le schéma et les données nécessaires.

`localhost` désigne la machine qui exécute le backend, pas l'ordinateur de Joel. Le port PostgreSQL (`5432` dans la configuration partagée) est distinct du port HTTP Express, qui reste à vérifier.

Variables utilisées, sans secret réel :

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mercasport
DB_USER=postgres
DB_PASSWORD=<mot de passe local, à ne pas versionner>
```

Le rôle local initial de Matteo était `matteobvl`. L'accompagnement a proposé de créer un rôle local `postgres` compatible avec la configuration partagée, puis la base. La connexion et la lecture d'une annonce ont ensuite réussi. Vérifier la configuration active avant toute nouvelle création ; ne pas recommencer l'installation.

`.env` et `node_modules/` doivent être ignorés par Git. Un éventuel `.env.example` ne contient que des valeurs non sensibles. Le mot de passe partagé dans l'historique n'est volontairement pas reproduit.

La commande de lancement utilisée pendant l'accompagnement était, depuis le dossier contenant ces fichiers :

```bash
node --env-file=.env server.js
```

Vérifier la version Node et les scripts de `package.json` avant de choisir la commande adaptée au dépôt. Ne pas ajouter `dotenv` ou changer la stack par automatisme.

Pour une nouvelle installation seulement : lire les scripts, préparer rôle/base, importer `schema.sql`, puis `seed.sql`, et vérifier les tables. **Ne pas réimporter le schéma sur la base actuelle sans examiner les éventuels `DROP`, suppressions ou doublons.**

## 7. État réel de l'avancement

Les statuts ci-dessous sont rapportés par la conversation ; ils ne sont pas issus de tests exécutés par Codex sur le dépôt actuel.

| Élément | État et preuve disponible |
| --- | --- |
| J1-BACK-01 : Express minimal | Terminé selon les échanges : serveur lancé et `/health` répond |
| J1-BACK-02 : contrat API | Document annoncé terminé par Matteo ; contenu et validation d'équipe à relire |
| PostgreSQL local | Tables créées et affichées selon Matteo ; une lecture via Node a réussi |
| `pg` et `db.js` | Pool configuré avec les cinq variables d'environnement et exporté en CommonJS |
| Test `verifierConnexion()` | Fonction écrite avec `async/await`, `try/catch` et `SELECT NOW()` ; lecture de `ads` réussie ensuite |
| J2-BACK-01 : connexion pg | Validé fonctionnellement dans la conversation par lecture d'une vraie annonce |
| J2-BACK-02 : `GET /ads` | Version temporaire avec tableau en mémoire testée : HTTP 200 et JSON ; version PostgreSQL non validée |
| J3-BACK-01 : `GET /ads/:id` | Proposé, puis mis en pause ; aucune réalisation validée dans les échanges consultés |
| J3-BACK-02 : `POST /applications` | Contrat discuté ; aucune insertion par cette route validée |
| Front et tâches complètes de Joel | Ne pas déduire leur achèvement à partir du planning |

La lecture réelle de `ads` a renvoyé une annonce de démonstration avec :

```text
id = 1
club_id = 1
title = [DEMO] Attaquant recherche
position = Attaquant
city = Hégenheim
description = annonce de démonstration attendant validation
status = pending
created_at = 2026-10-07T14:53:36.046Z
```

`result.rows` est un tableau d'objets JavaScript, chaque objet correspondant à une ligne SQL. Cette annonce `pending` prouve que la lecture fonctionne, mais ne doit pas apparaître dans la liste publique.

Notions déjà expliquées à Matteo, à consolider en pratique : rôle du Pool, Promise, `async/await`, portée de la suspension avec `await`, `try/catch`, `result.rows`, distinction entre résultat SQL et réponse Express (`res`).

## 8. Blocage actuel : cohérence du schéma et des requêtes

Le dernier extrait de `database/queries.sql` contient une requête de liste qui :

- Lit `a.short_description` et `a.team_id`.
- Relie `ads` à `teams`, puis `teams` à `clubs`.
- Retourne notamment `club`, `team` et `division`.
- Trie par `a.created_at DESC, a.id DESC`.
- **Ne filtre pas le statut des annonces.**

La requête de détail utilise le même trajet de relations, des champs supplémentaires (`preferred_foot`, `requirements`, `contract`, `work_time`, `salary`, `location`, `description`, `missions`) et `WHERE a.id = $1`.

La ligne précédemment observée expose plutôt `club_id` et `city`. Cette différence suggère un décalage entre schéma local et fichiers, ou une évolution du modèle ; **la cause n'est pas établie**. La liste de colonnes de la ligne observée ne remplace pas une inspection complète du schéma.

### Première étape à reprendre avec Matteo

Inspecter le code et les fichiers SQL en lecture seule, puis guider Matteo pour examiner la base active. Dans `psql`, connecté à `mercasport` :

```sql
SELECT current_database(), current_user;
\d public.ads
\d public.teams
\d public.clubs
```

Faire tester telle quelle la requête de liste existante dans `queries.sql`. Recueillir le résultat ou l'erreur exacte, sans secrets.

Ensuite seulement :

1. Comparer schéma actif, `schema.sql`, `queries.sql` et contrat API.
2. Identifier avec Joel quelle version du modèle l'équipe veut utiliser.
3. Guider Matteo vers une requête cohérente avec ce modèle et la règle de visibilité `approved`.
4. Laisser Matteo intégrer cette requête à `GET /ads` et examiner son essai.
5. Vérifier la réponse HTTP et la non-exposition des annonces non approuvées.

Ne pas ajouter des colonnes, recréer des tables ou réécrire la route pour résoudre l'incohérence sans diagnostic. Ne pas reprendre le détail ou les candidatures avant d'avoir consolidé la liste publique.

## 9. Contrat API de travail

Relire le document réellement écrit par Matteo et confirmer les noms avec Thomas et Joel. Les champs attendus par le front ne prouvent pas qu'ils existent dans la base.

| Route | Objectif | Comportement prévu |
| --- | --- | --- |
| `GET /health` | Vérifier que le serveur HTTP répond | Route déjà réalisée ; contenu exact à lire |
| `GET /ads` | Liste publique des annonces approuvées | `200` + tableau JSON, y compris `[]` si aucune annonce approuvée ; `500` en cas d'erreur serveur |
| `GET /ads/:id` | Détail d'une annonce | `200` si accessible, `404` si absente ; `500` en cas d'erreur serveur. Appliquer aussi la règle de visibilité publique au détail |
| `POST /applications` | Créer une candidature | `201` après création ; `400` pour données invalides/incomplètes ; `404` si annonce inexistante ; `500` pour erreur serveur |

Le contrat de liste discuté prévoit `id`, `title`, `short_description`, `club`, `position`. L'extrait SQL ajoute `team` et `division` : confirmer leur place dans le contrat plutôt que modifier silencieusement le JSON.

Le contrat provisoire de candidature prévoit `ad_id`, `name`, `email`, `phone`, `message`, avant authentification complète. Les champs obligatoires et la relation avec `players` restent à confronter au schéma. Plus tard, l'identité vient du compte connecté, sans faire confiance à un identifiant utilisateur arbitraire fourni par le client.

Les requêtes recevant une entrée utilisateur doivent être paramétrées, avec des valeurs séparées du SQL (`$1`, etc.), sans concaténation. Les détails d'erreur SQL servent au diagnostic côté serveur, pas à la réponse publique.

## 10. Tâches J1 / J2 / J3 et dépendances

Dates prévues dans le plan : J1 lundi 5 octobre, J2 mardi 6 octobre, J3 mercredi 7 octobre 2026. **Ce sont des étapes de progression, pas une preuve d'achèvement aux dates prévues.**

| ID | Responsable | Objectif / résultat à vérifier | Relecture |
| --- | --- | --- | --- |
| J1-DB-01 | Joel | Modèle de données v1 dessiné et expliqué | Thomas |
| J1-DB-02 | Joel | PostgreSQL installé et vérifié | Matteo |
| J1-FRONT-01 | Thomas | Cartographie des écrans | Joel |
| J1-FRONT-02 | Thomas | Squelette lisible du job board | Matteo |
| J1-BACK-01 | Matteo | Express démarre, route de santé, trajet requête/réponse expliqué | Thomas |
| J1-BACK-02 | Matteo | Contrat des trois routes métier, entrées/sorties et tables/écrans concernés compris | Joel + Thomas |
| J2-DB-01 | Joel | Noyau `clubs`/`ads`, relation, statut, données de test ; annonces avec club lisibles | Matteo |
| J2-DB-02 | Joel | Requêtes de liste/détail et filtre approuvé ; `JOIN` expliqué | Thomas |
| J2-BACK-01 | Matteo | `pg`, Pool et variables ; lecture réelle et erreur simple comprises | Joel |
| J2-BACK-02 | Matteo | `GET /ads` connecté au SQL, JSON cohérent et cas d'erreur vérifié | Thomas |
| J2-FRONT-01 | Thomas | `fetch()` affiche les vraies annonces et gère une erreur API | Matteo |
| J2-FRONT-02 | Thomas | Zone « Voir plus » sans popup ni rechargement | Joel |
| J3-DB-01 | Joel | `players` et `applications`, clés étrangères, message/date et candidature test | Thomas |
| J3-DB-02 | Joel | Modèle SQL cohérent avec les écrans et le contrat API | Équipe |
| J3-BACK-01 | Matteo | Détail par identifiant, requête paramétrée, succès et absence testés | Joel |
| J3-BACK-02 | Matteo | Champs reçus validés, candidature insérée, statut cohérent et SQL paramétré expliqué | Joel |
| J3-FRONT-01 | Thomas | « Voir plus » appelle le détail API et met à jour la page | Matteo |
| J3-FRONT-02 | Thomas | Formulaire lié à une annonce, envoi JSON et retour utilisateur | Joel |

Ordre de reprise pour Matteo : diagnostic SQL → vrai `GET /ads` → intégration liste avec Thomas → `GET /ads/:id` → modèle de candidature validé avec Joel → `POST /applications` → parcours complet.

Ne pas commencer automatiquement JWT ou l'authentification parce que le calendrier indique le sprint suivant. Consolider d'abord les dépendances et le trajet complet des annonces.

## 11. Vérifier et déboguer sans remplacer l'apprentissage

Pour chaque étape : comparer attendu/observé, reproduire, lire l'erreur, isoler une hypothèse, la tester, corriger localement et vérifier les régressions pertinentes.

Pour la liste publique, vérifier progressivement :

- Réponse `200` et tableau JSON issu de PostgreSQL.
- `[]` si aucune annonce n'est approuvée : cela n'est pas une erreur `404`.
- Aucune annonce `pending` ou `rejected` exposée.
- Champs cohérents avec le contrat frontend.
- Erreur de base gérée par une réponse `500`, sans fuite d'informations internes.

Pour le détail ensuite : identifiant existant, identifiant absent, entrée invalide selon le contrat retenu et annonce non publique. Pour la candidature : création persistée, champs invalides/manquants et annonce absente. Choisir les vérifications au fur et à mesure, sans construire tous les tests ou solutions à l'avance.

Le contrôle d'apprentissage doit rester bref et utile : expliquer le besoin, les données, la solution, les erreurs et le test. Ne pas imposer un quiz après chaque message.

## 12. Reprise dans VS Code

Placer ce document dans le vrai dépôt MercaSport, en préservant ou en intégrant le README existant s'il y en a un. Ouvrir la racine du dépôt pour permettre l'inspection du backend, du SQL et du contrat API.

Message de reprise suggéré :

> Lis README.md et les éventuelles instructions AGENTS.md du dépôt. Accompagne-moi comme débutant, une étape à la fois, sans solution complète sauf demande explicite. Commence par inspecter en lecture seule l'état Git, le backend, docs/api.md et les fichiers SQL, sans lire les secrets du .env. Notre connexion pg fonctionne ; nous devons vérifier la cohérence entre le schéma local et queries.sql avant de terminer GET /ads. Donne-moi ensuite la première tâche concrète, sans modifier les fichiers.

Après une étape importante, mettre à jour ce contexte seulement sur demande : acquis, résultat observé, difficulté restante et prochaine action. Ne pas prétendre connaître un historique inaccessible.

## 13. Sources et limites

- Conversation ChatGPT « Guidage projet groupe », identifiant `6ac37055-ce18-83eb-8332-c77f45599550` : code partagé, résultats et point de reprise.
- `MercaSport_Plan_Jours_1_2_3_05-07_octobre_2026.pdf` : tâches J1/J2/J3, dépendances, reviewers et critères pédagogiques.
- `MercaSport_Plan_Scrum_Pedagogique_v2.pdf` : MVP, règles IA, organisation Git et planning indicatif jusqu'au 19 octobre 2026.
- `jobBoard-project.pdf` : exigences du sujet Epitech.
- `jobBoard-bootstrap.pdf` : exercice préparatoire SQL/API/front. Ses routes d'exemple HireLoop ne remplacent pas le contrat MercaSport.

Le schéma complet actif, l'état du dépôt Git et l'avancement réel des autres membres restent à inspecter. Le présent document ne certifie ni une exécution récente, ni une installation, ni une conformité complète au sujet.
