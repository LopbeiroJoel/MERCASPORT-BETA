// REPERE ORAL - CONNEXION A LA BASE (doc, section 5).
// pg parle a PostgreSQL ; Neon heberge PostgreSQL ; Vercel fait tourner le serveur.
// DATABASE_URL vient du .env local ou des variables privees Vercel. Aucun secret a montrer ici.
// Le compte PostgreSQL de cette URL n'est pas le joueur ou le club qui se connecte au site.
// Pool = connexions reutilisables. Une route recoit ce Pool, elle ne connait pas le mot de passe en dur.

// pg est le connecteur Node/PostgreSQL ; Pool gère des connexions réutilisables.
const { Pool } = require('pg');

// DATABASE_URL pour la base hébergée, DB_* pour les configurations locales existantes.
// process.env lit la configuration injectée au lancement, sans écrire les secrets dans le code.
// Condition ? A : B : utilise l'URL complète si elle existe, sinon les variables DB_*.
// Si DATABASE_URL existe, je prends l'URL Neon complete. Sinon je garde la configuration locale DB_*.
const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      // host = machine PostgreSQL ; port = port de la base, différent du port HTTP 3000.
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      // Nom de la base à utiliser ; user/password identifient le compte PostgreSQL.
      // Ce compte est distinct des comptes joueur/club de l'application.
      database: process.env.DB_NAME || 'mercasport',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };

// Crée un Pool partagé ; les connexions sont ouvertes selon les besoins des requêtes.
// max: 5 vaut pour ce processus. Plusieurs instances Vercel peuvent avoir chacune leur Pool.
// 5000 ms = 5 secondes ; statement_timeout vaut 10 secondes pour une instruction SQL.
const pool = new Pool({
  // ... copie les propriétés de config dans cet objet de configuration.
  ...config,
  // Au maximum cinq connexions dans ce Pool ; les demandes peuvent attendre une connexion libre.
  max: 5,
  // Délai maximal pour obtenir une connexion : 5 secondes (valeur en millisecondes).
  connectionTimeoutMillis: 5000,
  // Ferme une connexion restée inutilisée dans le Pool pendant 5 secondes.
  idleTimeoutMillis: 5000,
  // PostgreSQL interrompt une instruction SQL qui dépasse 10 secondes.
  statement_timeout: 10000,
});

// Écoute les erreurs des connexions inactives ; les erreurs des requêtes passent par leurs Promises.
pool.on('error', () => console.error('Connexion PostgreSQL interrompue.'));
// Sur Vercel uniquement, associe le Pool au cycle de vie de l'environnement hébergé.
// Ce branchement aide Vercel a gerer les connexions ; il ne cree pas les tables a ma place.
if (process.env.VERCEL) {
  const { attachDatabasePool } = require('@vercel/functions');
  attachDatabasePool(pool);
}

// Exporte le Pool ; require('./db') récupère cet objet partagé dans ce processus Node.
module.exports = pool;
