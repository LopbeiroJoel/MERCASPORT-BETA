# Documentation — ajouts au backend

Tous les changements de cette étape sont dans `backend/authentication/`, le module créé pour AUTH-02. Les fichiers du serveur actuel, les routes annonces/candidatures, le frontend, la configuration Vercel et la base Neon n’ont pas été modifiés.

## Nouveaux fichiers

| Fichier | Utilité |
| --- | --- |
| `security.sql` | Migration additive : sessions, compteurs de tentatives et jetons de réinitialisation. |
| `rate-limit.js` | Compteurs SQL atomiques, partagés entre instances, avec IP/identifiants sous forme d’empreintes. |
| `permissions.js` | Vérifie connexion, rôle et éventuellement statut APPROVED sur une route. |
| `logout-router.js` | Prépare POST /auth/logout : révoque la session et efface le cookie. |
| `reset-router.js` | Prépare POST /auth/forgot-password et POST /auth/reset-password. Envoi désactivé tant qu’un adaptateur de file durable n’est pas fourni. |
| `tests/setup-security.js` | Applique la migration uniquement dans la base jetable des tests. |
| `tests/security-flow.test.js` | 8 tests : parcours API complet, déconnexion, permissions, limites partagées, réinitialisation, concurrence et rollback. |
| `AUTHENTIFICATION.md`, `SECURITE.md`, `AJOUTS-BACKEND.md` | Les trois guides de cette étape. |
| `DOCUMENTATION-EXCEL.txt` | Lignes à copier-coller dans le tableau de suivi. |

## Fichiers du module AUTH-02 mis à jour

| Fichier | Modification |
| --- | --- |
| `session.js` | Ajoute le registre SQL, la révocation d’une session et la lecture du rôle/statut actuel. Conserve le cookie signé et le contrôle du hash du mot de passe. |
| `router.js` | La route login utilise désormais le limiteur SQL partagé à la place du compteur en mémoire. |
| `tests/login.test.js` | Applique le nouveau schéma de test et adapte le test de limitation. |
| `README.md` | Renvoie vers les trois guides et précise les prérequis de cette version. |

Aucune dépendance npm supplémentaire n’est nécessaire pour SEC-02 / AUTH-03 : les modules utilisent Node.js, Express, pg, jose et le hashage déjà installé pour AUTH-02/SEC-01.

## Brancher plus tard

1. Vérifier puis exécuter `backend/authentication/security.sql` dans la base cible. Sans les trois tables, cette version de la connexion refusera le traitement.
2. Installer les dépendances des modules registration, authentication et licenses, comme indiqué dans leurs guides.
3. Configurer AUTH_SECRET et APP_ORIGIN en variables privées du backend.
4. Monter les routes avant les parseurs globaux, les fichiers statiques et la réponse 404.
5. Ajouter les permissions aux actions nécessitant une connexion, puis brancher les formulaires frontend.
6. Pour le mot de passe oublié, fournir plus tard une file d’envoi durable ; aucun service d’e-mail n’a été choisi ou activé.

```js
const { createSessionService } = require('./backend/authentication/session');
const { createLoginRouter } = require('./backend/authentication/router');
const { createLogoutRouter } = require('./backend/authentication/logout-router');
const { createResetRouter } = require('./backend/authentication/reset-router');
const { requirePermission } = require('./backend/authentication/permissions');

const sessions = createSessionService(pool, {
  secret: process.env.AUTH_SECRET,
  origins: [process.env.APP_ORIGIN],
});
app.use('/auth', createLoginRouter(pool, { sessions }));
app.use('/auth', createLogoutRouter(sessions));
app.use('/auth', createResetRouter(pool, {
  sessions,
  // enqueueResetLink et appOrigin à fournir seulement lors de l’activation de l’envoi.
}));
```

Cet exemple de montage n’a pas été exécuté sur le serveur actuel. Les modules de licence peuvent recevoir `authenticate: sessions.authenticate` comme avant. La réinitialisation exige aussi la création d’une page frontend qui lit le fragment du lien et soumet le nouveau mot de passe.

## Où en sont les tâches ?

- SEC-02 : implémenté et testé dans les modules locaux ; migration et protection des routes réelles à brancher.
- AUTH-03 : mécanisme de lien à usage unique implémenté et testé ; envoi réel désactivé et page frontend à créer.
- TEST-01 : parcours API des modules vérifié sur une base jetable ; parcours navigateur et hébergement à tester après intégration.

Les ajouts de cette étape sont livrés sur api/registration, sans fusion dans main ni déploiement. Les modifications ne concernent que le module ajouté par Joel.
