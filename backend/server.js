// REPERE ORAL - DEUXIEME POINT D'ENTREE, MEME APPLI.
// Ce fichier renvoie vers server.js a la racine : je ne recrée pas toutes les routes ici.
// Si je lance depuis backend/, je retrouve donc le meme serveur.

const app = require('../server');
const { startServer } = require('./app');

// Reutiliser la meme application pour les deux commandes de lancement.
module.exports = app;
if (require.main === module) startServer(app);
