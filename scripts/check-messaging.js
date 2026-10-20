// Vérifie aussi le JavaScript navigateur : le build ne fait que copier les fichiers.
const { execFileSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const files = ['backend/messaging', 'backend/recruitment'].flatMap(folder =>
  readdirSync(join(root, folder)).filter(name => name.endsWith('.js')).map(name => join(folder, name))
);
files.push(...['recruitment-ui', 'messages', 'annonces', 'candidatures', 'cv', 'moderation'].map(name => `frontend/js/${name}.mjs`));
for (const file of files) execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' });
console.log(`${files.length} modules vérifiés.`);
