# Authentification — modules de Joel

AUTH-02 a été livré sur api/registration. Les mises à jour SEC-02 / AUTH-03 / TEST-01 sont livrées sur api/registration, à intégrer et à configurer avant utilisation sur le site. Le serveur actuel, le frontend, Neon et Vercel n’ont pas été modifiés.

Trois documents expliquent cette version :

- [Authentification](AUTHENTIFICATION.md) : connexion, déconnexion, lien de réinitialisation et exemples JSON.
- [Sécurité](SECURITE.md) : sessions révocables, permissions, origines et limites SQL partagées.
- [Ajouts au backend](AJOUTS-BACKEND.md) : fichiers ajoutés/modifiés et exemple de montage futur.
- [Documentation Excel](DOCUMENTATION-EXCEL.txt) : suivi des tâches à copier-coller.

## Prérequis

Node.js 22 ou supérieur. Installer les dépendances de registration et authentication :

```bash
npm ci --prefix backend/registration --workspaces=false --ignore-scripts
npm ci --prefix backend/authentication --workspaces=false --ignore-scripts
```

Avant d’activer cette version, vérifier et appliquer `security.sql` dans la base cible. Cette migration ajoute uniquement auth_sessions, auth_rate_limits et password_reset_tokens. Elle a été exécutée uniquement sur les bases jetables des tests. Les JWT de l’ancienne version, sans session enregistrée, seront refusés après activation.

Configurer AUTH_SECRET (32 octets aléatoires encodés en 64 caractères hexadécimaux) et APP_ORIGIN (origine HTTPS exacte). Garder les secrets dans les variables privées du serveur, jamais dans Git ou le frontend. Les cookies exigent HTTPS.

Les routes restent à monter avant les parseurs globaux et la réponse 404. Le changement du module ne protège pas les routes actuelles automatiquement. Aucun adaptateur d’e-mail n’est fourni : forgot-password retourne 503 tant que l’envoi n’est pas configuré. Le futur lien pointe vers une page frontend reset-password encore à créer.

## Tests

Les tests utilisent PGlite, des comptes fictifs et des adaptateurs fictifs de stockage et d’envoi. Ils ne contactent pas Neon. Express, pg et PGlite doivent être disponibles dans l’environnement de test ; sur ce poste ils sont fournis par l’environnement externe via NODE_PATH.

```bash
MERCASPORT_TEST_PGLITE=1 node --test backend/authentication/tests/login.test.js backend/authentication/tests/security-flow.test.js
```

La série authentication comporte 18 tests. La série complète avec registration et licenses comporte 49 tests. TEST-01 couvre le parcours API ; un test du navigateur et de l’hébergement sera nécessaire lors de l’intégration.