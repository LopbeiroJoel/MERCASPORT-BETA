const app = require('../server');
const { startServer } = require('./app');

// Reutiliser la meme application pour les deux commandes de lancement.
module.exports = app;
if (require.main === module) startServer(app);
