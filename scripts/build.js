// REPERE ORAL - PREPARER LE FRONT POUR VERCEL.
// Je copie frontend/ vers public/. C'est une sortie generee, pas un deuxieme front a modifier.
// Ce script n'execute aucun SQL et ne copie pas le .env : un push ne migre donc pas Neon.

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'public');
// public/ contient uniquement les fichiers générés par cette commande.
if (path.relative(root, target) !== 'public') throw new Error('Dossier de sortie invalide');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(root, 'frontend'), target, { recursive: true });
console.log('Frontend préparé dans public/ pour Vercel.');
