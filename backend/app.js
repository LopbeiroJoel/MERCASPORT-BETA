// REPERE ORAL - LE PLAN DES ROUTES (doc, sections 4, 7 et 8).
// Je lis ce fichier pour savoir quelle URL arrive dans quel module.
// req.params = morceau de chemin ; req.query = apres ? ; req.body = JSON envoye.
// Une route HTTP n'est pas un fichier SQL : la fonction de la route appelle ensuite pool.query.
// L'ordre compte : routeurs, routes publiques, fichiers statiques, 404, puis erreurs.
// POST /ads permet aux clubs actifs de publier. Les candidatures utilisent POST /applications.

// Express permet de définir les routes HTTP et les traitements communs aux requêtes.
const express = require('express');
// Module intégré à Node : construit des chemins de fichiers adaptés au système.
const path = require('node:path');
const { createRegistrationRouter } = require('./registration/router');
const { createSessionService } = require('./authentication/session');
const { createLoginRouter } = require('./authentication/router');
const { createLogoutRouter } = require('./authentication/logout-router');
const { createProfileRouter } = require('./profile');
const { createAdminRouter } = require('./admin/router');
const { createAdsRouter } = require('./ads/router');
const { createMessagingRouter } = require('./messaging/router');
const { createRecruitmentRouter } = require('./recruitment/router');
const { createRecruitmentAdminRouter } = require('./recruitment/admin');

// Fragment SQL partagé par la liste et le détail : évite de répéter les colonnes.
// AS renomme un champ dans le résultat ; coalesce choisit la première valeur non NULL.
// Les accents graves créent une chaîne multiligne ; ${adColumns} l'insère dans le SQL.
// Ce fragment est défini par le développeur, pas fourni par l'utilisateur.
const adColumns = `id, club_id, club_name AS club, team_id, team_name AS team,
  division, title, short_description, position, preferred_foot, requirements,
  contract, work_time, salary, coalesce(location, city) AS location,
  description, missions, created_at`;

// Masquer les annonces supprimees et celles des comptes bloques.
// Le public voit les annonces publiees dont l'auteur n'est pas bloque.
// Ici je ne reserve pas la liste a un role PLAYER ou CLUB : meme un visiteur peut la lire.
const visibleAdsFilter = `id IN (
  SELECT a.id FROM public.ads a
  LEFT JOIN public.users u ON u.id = a.author_id
  WHERE a.status = 'PUBLISHED'
    AND ((to_jsonb(a)->>'expires_at') IS NULL OR (to_jsonb(a)->>'expires_at')::timestamptz>now())
    AND coalesce(to_jsonb(a)->>'announcement_type','CLUB_SEARCH')='CLUB_SEARCH'
    AND COALESCE(u.status, '') NOT IN ('BANNED', 'DISABLED')
)`;

// Vérifie qu'un identifiant est un entier positif utilisable par une colonne INTEGER PostgreSQL.
// typeof vérifie le type ; includes accepte ici un nombre ou une chaîne.
// La regex exige des chiffres, sans zéro initial : ^ = début, $ = fin, \d = chiffre.
// && signifie ET : toutes les conditions doivent être vraies.
// Number convertit en nombre ; isSafeInteger évite les entiers imprécis en JavaScript.
// 2147483647 est la valeur maximale d'un INTEGER PostgreSQL signé.
function validId(value) {
  return ['number', 'string'].includes(typeof value) && /^(?:[1-9]\d*)$/.test(String(value))
    && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647;
}

// Reçoit l'application Express et le Pool PostgreSQL, puis installe les traitements.
// Un middleware est une fonction qui intervient dans le parcours d'une requête.
// L'ordre des app.use et des routes compte : Express les examine dans l'ordre d'installation.
function configureApp(app, pool, { authSecret = process.env.AUTH_SECRET, appOrigin = process.env.APP_ORIGIN } = {}) {
  // Retire l'en-tête qui annonce l'utilisation d'Express.
  app.disable('x-powered-by');

  // Ajouter les comptes sans modifier les routes d'annonces et de candidatures.
  let sessions = null;
  if (authSecret && appOrigin) {
    try {
      sessions = createSessionService(pool, {
        secret: authSecret,
        origins: [appOrigin],
        allowLocalHttp: !process.env.VERCEL && process.env.NODE_ENV !== 'production'
      });
    } catch {
      console.error('Configuration de connexion invalide.');
    }
  }
  // PREFIXES : /login dans ce routeur devient /auth/login ; /me devient /auth/me.
  app.use('/auth', createLoginRouter(pool, { sessions }));
  app.use('/auth', createLogoutRouter(sessions));
  app.use('/auth', createRegistrationRouter(pool));
  // GET/PATCH /profile/me : lecture et modification du compte de la session.
  app.use('/profile', createProfileRouter(pool, sessions));
  // Toutes les routes du panel passent par les permissions du routeur admin.
  app.use(createRecruitmentRouter(pool, sessions));
  app.use(createMessagingRouter(pool, sessions));
  app.use('/admin', createRecruitmentAdminRouter(pool, sessions));
  app.use('/admin', createAdminRouter(pool, sessions));
  app.use('/ads', createAdsRouter(pool, sessions));

  // Décode les corps application/json vers req.body et limite leur taille à 16 Ko.
  // Ne lit pas les formulaires classiques ; un JSON mal formé part vers le gestionnaire d'erreurs.
  app.use(express.json({ limit: '16kb' }));

  // Une route associe une méthode HTTP (GET) et un chemin (/health) à une fonction.
  // req contient la demande ; res permet de construire la réponse.
  // async permet d'utiliser await ; la fonction renvoie une Promise.
  // TEST DE CONNEXION : SELECT 1 ne prouve pas que toutes les migrations ont ete appliquees.
  app.get('/health', async (req, res) => {
    // Test SQL minimal : vérifie que la base répond, sans vérifier toutes les tables.
    // await suspend cette fonction jusqu'au résultat ; il ne bloque pas tout le serveur.
    await pool.query('SELECT 1');
    // no-store demande de ne pas stocker la réponse en cache.
    // json convertit l'objet en JSON ; statut 200 par défaut, Date devient une chaîne ISO.
    res.set('Cache-Control', 'no-store').json({ status: 'OK', timestamp: new Date() });
  });

  // Liste des annonces : lecture dans PostgreSQL, puis réponse sous forme de tableau.
  // LECTURE DE LISTE : la vue rassemble les tables et result.rows donne un tableau d'annonces.
  // Liste vide = 200 avec [], pas 404.
  app.get('/ads', async (req, res) => {
    // pool.query emprunte une connexion, exécute le SQL puis rend la connexion au Pool.
    // ads_details est une vue SQL réunissant les annonces, leurs équipes et leurs clubs.
    // DESC trie du plus récent au plus ancien ; l'ID départage les dates identiques.
    // $1 est un paramètre SQL : sa valeur vient du premier élément du tableau séparé.
    // pg transmet SQL et valeurs séparément : l'ID ne devient pas du code SQL.
    // INSERT ... SELECT insère seulement si l'annonce existe ; sinon, aucune ligne insérée.
    // $1 à $5 correspondent dans l'ordre aux cinq valeurs du tableau.
    // RETURNING renvoie l'ID et la date générés par la base pour la nouvelle candidature.
    const result = await pool.query(`SELECT ${adColumns} FROM public.ads_details
      WHERE ${visibleAdsFilter}
      ORDER BY created_at DESC, id DESC`);
    // result est le résultat pg ; result.rows est le tableau des lignes (objets JavaScript).
    // Même sans annonce, on renvoie 200 et [] : une liste vide reste une réponse valide.
    res.set('Cache-Control', 'no-store').json(result.rows);
  });

  // :id est une partie variable de l'URL : /ads/7 donne req.params.id === '7'.
  // LECTURE D'UN ELEMENT : /ads/7 donne le texte '7' dans req.params.id.
  // 400 si l'ID est mal forme ; 404 si aucune annonce visible ne correspond.
  app.get('/ads/:id', async (req, res) => {
    // ! signifie NON : si l'ID est invalide, répondre avant d'interroger PostgreSQL.
    if (!validId(req.params.id)) {
      // 400 = demande invalide. return arrête la fonction pour éviter une deuxième réponse.
      return res.status(400).json({ error: 'Identifiant d’annonce invalide.' });
    }
    // $1 est un paramètre SQL : sa valeur vient du premier élément du tableau séparé.
    // pg transmet SQL et valeurs séparément : l'ID ne devient pas du code SQL.
    const result = await pool.query(
      `SELECT ${adColumns} FROM public.ads_details WHERE id = $1 AND ${visibleAdsFilter}`, [Number(req.params.id)]);
    // length est le nombre de lignes ; !0 vaut true : aucun résultat trouvé.
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Annonce introuvable.' });
    }
    // [0] sélectionne la première ligne : le détail renvoie un objet, pas un tableau.
    res.set('Cache-Control', 'no-store').json(result.rows[0]);
  });

  // POST reçoit les informations nécessaires pour créer une candidature en base.
  // CREATION D'UNE CANDIDATURE : ad_id arrive dans le JSON, pas dans l'URL actuelle.
  // Le sujet demande /ads/:id/applications : notre route main fonctionne mais son chemin est different.
  app.post('/applications', async (req, res) => {
    // Vérifie le Content-Type annoncé par le client : ici on accepte du JSON.
    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'Envoyer les données au format application/json.' });
    }
    // req.body a été préparé par express.json ; les données restent à valider.
    const body = req.body;
    // Refuse l'absence de données, les tableaux et les valeurs qui ne sont pas des objets.
    // || signifie OU : une seule condition vraie suffit à refuser la demande.
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      return res.status(400).json({ error: 'Candidature invalide.' });
    }
    // Déstructuration : extrait cinq propriétés de body dans cinq variables.
    // Plus bas, INSERT ... SELECT cree la candidature seulement si l'annonce trouvee est disponible.
    // $1...$5 separent les valeurs du SQL ; RETURNING redonne l'ID et la date crees.
    const { ad_id, name, email, phone, message } = body;
    // Vérifie ID, nom non vide, email et limites de longueur avant toute insertion.
    // trim retire les espaces aux extrémités ; typeof vérifie avant d'appeler les méthodes.
    // La regex email vérifie une forme simple, pas l'existence de l'adresse.
    // != null accepte l'absence (undefined) ou null pour les champs facultatifs.
    // Si téléphone/message sont fournis, leur type et leur longueur sont contrôlés.
    if (!validId(ad_id) || typeof name !== 'string' || !name.trim() || name.trim().length > 200
      || typeof email !== 'string' || email.trim().length > 255
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      || (phone != null && (typeof phone !== 'string' || phone.trim().length > 30))
      || (message != null && (typeof message !== 'string' || message.length > 2000))) {
      return res.status(400).json({ error: 'Vérifier l’annonce, le nom, l’email et les longueurs des champs.' });
    }
    // $1 est un paramètre SQL : sa valeur vient du premier élément du tableau séparé.
    // pg transmet SQL et valeurs séparément : l'ID ne devient pas du code SQL.
    // INSERT ... SELECT insère seulement si l'annonce existe ; sinon, aucune ligne insérée.
    // $1 à $5 correspondent dans l'ordre aux cinq valeurs du tableau.
    // RETURNING renvoie l'ID et la date générés par la base pour la nouvelle candidature.
    const result = await pool.query(`
      INSERT INTO public.applications (ad_id, name, email, phone, message)
      SELECT id, $2, $3, $4, $5 FROM public.ads WHERE id = $1 AND ${visibleAdsFilter}
      RETURNING id, created_at`, [Number(ad_id), name.trim(), email.trim().toLowerCase(),
      // ?. appelle trim seulement si phone n'est ni null ni undefined.
      // || null remplace un téléphone vide par NULL ; ?? remplace uniquement null/undefined.
      // Le nom est nettoyé, l'email est nettoyé et mis en minuscules, le message reste tel quel.
      phone?.trim() || null, message ?? '']);
    // length est le nombre de lignes ; !0 vaut true : aucun résultat trouvé.
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Annonce introuvable.' });
    }
    // 201 = ressource créée : on répond après la réussite de l'insertion SQL.
    res.status(201).json(result.rows[0]);
  });

  // Même origine pour le HTML et l’API en local ; public/ sera servi par Vercel.
  // Sert aussi les fichiers du front ; __dirname désigne le dossier de ce fichier JS.
  // Une requête non traitée par une route peut ainsi recevoir un fichier HTML/CSS/JS.
  // Si aucune API n'a repondu, je peux servir un HTML/CSS/JS du dossier frontend.
  app.use(express.static(path.join(__dirname, '../frontend')));
  // Aucun traitement précédent n'a répondu : 404 = route ou fichier introuvable.
  app.use((req, res) => res.status(404).json({ error: 'Route introuvable.' }));

  // Middleware d'erreurs : Express reconnaît ses quatre paramètres (error, req, res, next).
  // Avec Express 5, une Promise rejetée dans une route async arrive automatiquement ici.
  // On centralise les erreurs au lieu de répéter try/catch dans chaque route.
  // Express reconnait ce gestionnaire avec ses quatre arguments. Il recoit aussi les erreurs async.
  // Je renvoie un code utile, mais pas les secrets ou les details SQL au navigateur.
  app.use((error, req, res, next) => {
    // Si la réponse a déjà commencé, transmet l'erreur à Express via next(error).
    if (res.headersSent) return next(error);
    // JSON mal formé : 400. Corps dépassant la limite express.json : 413.
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON invalide.' });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Requête trop volumineuse.' });
    }
    // Code PostgreSQL 23505 = violation d'une contrainte d'unicité.
    // Ici, notamment : même email pour la même annonce. 409 = conflit.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Une candidature avec cet email existe déjà pour cette annonce.' });
    }
    // 23503 = référence inexistante (clé étrangère) ; 23514 = règle CHECK violée.
    if (error.code === '23503' || error.code === '23514') {
      return res.status(400).json({ error: 'Candidature incompatible avec les données de l’annonce.' });
    }
    // Ne pas renvoyer les détails SQL, les paramètres ni les identifiants de connexion.
    console.error('Erreur API :', error.code || error.name);
    // Repère les erreurs de réseau/connexion et certains codes PostgreSQL d'indisponibilité.
    // startsWith('08') reconnaît la famille SQL des erreurs de connexion.
    // ?. protège l'appel si code est absent ; /.../i cherche sans distinguer la casse.
    const unavailable = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
      '28P01', '28000', '3D000', '53300', '57P01', '57P02', '57P03'].includes(error.code)
      || error.code?.startsWith('08') || /connection|timeout/i.test(error.message);
    // Condition ? valeurSiVrai : valeurSiFaux : 503 si indisponible, sinon 500.
    // Le client reçoit un message générique, sans détails internes de PostgreSQL.
    res.status(unavailable ? 503 : 500).json({
      error: 'Service temporairement indisponible. Réessayer plus tard.',
    });
  });
  // Rend l'application configurée à celui qui a appelé configureApp.
  return app;
}

// Configurer les routes et ouvrir un port sont deux étapes distinctes.
// Cela permet aux tests de choisir leur propre port sans démarrer le serveur habituel.
function startServer(app) {
  // process.env contient les variables d'environnement ; utilise 3000 si PORT est absent.
  const port = Number(process.env.PORT || 3000);
  // Ouvre le serveur HTTP sur l'adresse locale uniquement, au port choisi.
  // La fonction de rappel s'exécute lorsque le serveur est prêt à écouter.
  return app.listen(port, '127.0.0.1', () => {
    console.log(`MercaSport : http://localhost:${port}`);
  });
}

// CommonJS : rend ces fonctions disponibles aux fichiers qui utilisent require('./app').
module.exports = { configureApp, startServer };
