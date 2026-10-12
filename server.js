// Point d'entrée à la racine utilisé par npm start ; même logique que backend/server.js.
const express = require('express');
// Importe la connexion PostgreSQL commune au backend.
const pool = require('./backend/db');
// Importe les fonctions qui configurent les routes et démarrent l'écoute HTTP.
const { configureApp, startServer } = require('./backend/app');

// Crée l'application Express et lui transmet le Pool utilisé par les routes.
const app = configureApp(express(), pool);

// Vercel importe l’application ; npm start ouvre le serveur local.
// Permet à un autre programme d'importer l'application sans ouvrir de port.
module.exports = app;
// Lance l'écoute seulement lors d'une exécution directe de ce fichier.
if (require.main === module) startServer(app);
