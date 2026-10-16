// REPERE ORAL - DEPART DU BACKEND (doc, section 4).
// Ici je cree l'appli, je branche le Pool PostgreSQL et j'installe les routes.
// Trajet a retenir : navigateur -> Express -> Pool pg -> Neon -> JSON -> navigateur.
// npm start execute ce fichier ; Vercel l'importe. Ce n'est pas le navigateur qui joint Neon.

// Point d'entrée à la racine utilisé par npm start ; même logique que backend/server.js.
const express = require('express');
// Importe la connexion PostgreSQL commune au backend.
const pool = require('./backend/db');
// Importe les fonctions qui configurent les routes et démarrent l'écoute HTTP.
const { configureApp, startServer } = require('./backend/app');

// Crée l'application Express et lui transmet le Pool utilisé par les routes.
// Je donne le meme Pool a la configuration : les routes vont reutiliser cet objet.
const app = configureApp(express(), pool);

// Vercel importe l’application ; npm start ouvre le serveur local.
// Permet à un autre programme d'importer l'application sans ouvrir de port.
module.exports = app;
// Lance l'écoute seulement lors d'une exécution directe de ce fichier.
// Si je fais node server.js, j'ecoute sur le port local. Si Vercel importe le fichier, je n'ouvre pas de port ici.
if (require.main === module) startServer(app);
