// require charge un module CommonJS ; express est une dépendance installée avec npm.
const express = require('express');
// Récupère le Pool partagé qui communique avec PostgreSQL.
const pool = require('./db');
// Récupère les deux fonctions exportées par app.js (déstructuration).
const { configureApp, startServer } = require('./app');

// express() crée l'application ; configureApp lui ajoute les routes et middlewares.
const app = configureApp(express(), pool);
// Exporte l'application pour permettre son import, notamment par un hébergeur ou un test.
module.exports = app;
// Vrai si ce fichier est lancé directement avec node server.js : démarre alors l'écoute HTTP.
// Faux si un autre fichier l'importe avec require : l'import seul n'ouvre pas de port.
if (require.main === module) startServer(app);
