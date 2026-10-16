// REPERE ORAL - CLUBS, EQUIPES, CANDIDATURES ET CATALOGUES.
// La boucle declare les GET liste/detail pour cinq tables connues, pas une table libre envoyee par le client.
// Pour positions/divisions, :id est un CODE (STRIKER, R3), pas un nombre.
// Supprimer une ressource utilise DELETE ; si elle est encore utilisee, certaines suppressions sont refusees en 409.

const express = require('express');
const { validateUserUpdate } = require('./user-validation');
const { playerPositions } = require('../registration/validation');
const { fail, id, body, text, transaction, insert, update } = require('./helpers');
const divisions = ['D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'R3', 'R2', 'R1', 'N3', 'N2', 'N1'];

function createResourcesRouter(pool) {
  const router = express.Router();

  // Même lecture simple pour ces cinq tables métier, avec pagination.
  // Les cinq noms sont ecrits dans le code : aucun SELECT sur une table choisie librement par le visiteur.
  for (const table of ['clubs', 'teams', 'applications', 'positions', 'divisions']) {
    const key = ['positions', 'divisions'].includes(table) ? 'code' : 'id';
    // GET /admin/clubs, /teams, /applications, /positions ou /divisions : limit et offset gerent la pagination.
    router.get('/' + table, async (req, res) => {
      const limit = req.query.limit ?? '50';
      const offset = req.query.offset ?? '0';
      if (typeof limit !== 'string' || typeof offset !== 'string' || !/^\d+$/.test(limit) ||
          !/^\d+$/.test(offset) || Number(limit) < 1 || Number(limit) > 100 || Number(offset) > 1000000) {
        fail(400, 'INVALID_PAGINATION');
      }
      const result = await pool.query(`SELECT * FROM public.${table}
        ORDER BY ${key === 'code' ? 'sort_order' : 'id'} LIMIT $1 OFFSET $2`, [Number(limit), Number(offset)]);
      res.json({ [table]: result.rows });
    });
    // GET d'un element : nombre pour club/equipe/candidature, code pour poste/division.
    router.get('/' + table + '/:id', async (req, res) => {
      const value = key === 'id' ? id(req.params.id) : req.params.id;
      if (key === 'code' && !/^[A-Z0-9_]{1,50}$/.test(value)) fail(400, 'INVALID_CODE');
      const result = await pool.query(`SELECT * FROM public.${table} WHERE ${key} = $1`, [value]);
      if (!result.rows.length) fail(404, 'NOT_FOUND');
      res.json({ [table.slice(0, -1)]: result.rows[0] });
    });
  }

  // Le nom/la ville du club sont synchronises avec club_profiles si un compte lui appartient.
  async function saveClub(req, res) {
    const editing = req.method === 'PATCH';
    const input = body(req.body, editing ? ['name', 'city', 'divisions'] : ['name', 'city', 'divisions', 'user_id'],
      editing ? [] : ['name', 'city']);
    const data = {};
    for (const field of ['name', 'city', 'divisions']) {
      if (Object.hasOwn(input, field)) data[field] = text(input[field], field === 'name' ? 150 : 100, field !== 'divisions');
    }
    if (!editing) data.user_id = input.user_id == null ? null : id(input.user_id);
    const club = await transaction(pool, req.admin.userId, async client => {
      if (data.user_id) {
        const owner = await client.query("SELECT id FROM public.users WHERE id = $1 AND upper(role) = 'CLUB' FOR SHARE", [data.user_id]);
        if (!owner.rows.length) fail(400, 'CLUB_OWNER_REQUIRED');
      }
      const result = editing ? await update(client, 'clubs', 'id', id(req.params.id), data) : await insert(client, 'clubs', data);
      if (result.user_id) {
        await client.query(`INSERT INTO public.club_profiles(user_id, name, city, divisions) VALUES ($1,$2,$3,$4)
          ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, divisions = EXCLUDED.divisions`,
        [result.user_id, result.name, result.city, result.divisions]);
      }
      return result;
    });
    res.status(editing ? 200 : 201).json({ club });
  }
  router.post('/clubs', saveClub);
  router.patch('/clubs/:id', saveClub);
  router.delete('/clubs/:id', async (req, res) => {
    await transaction(pool, req.admin.userId, async client => {
      const clubId = id(req.params.id);
      const result = await client.query('SELECT user_id FROM public.clubs WHERE id = $1 FOR UPDATE', [clubId]);
      if (!result.rows.length) fail(404, 'NOT_FOUND');
      const used = await client.query(`SELECT 1 FROM public.teams WHERE club_id = $1
        UNION ALL SELECT 1 FROM public.ads WHERE club_id = $1 LIMIT 1`, [clubId]);
      if (used.rows.length) fail(409, 'RESOURCE_IN_USE');
      await client.query('DELETE FROM public.clubs WHERE id = $1', [clubId]);
      if (result.rows[0].user_id) await client.query('DELETE FROM public.club_profiles WHERE user_id = $1', [result.rows[0].user_id]);
    });
    res.status(204).end();
  });

  // Une equipe appartient a un club ; je verifie sa division et je ne deplace pas une equipe utilisee sans controle.
  async function saveTeam(req, res) {
    const editing = req.method === 'PATCH';
    const input = body(req.body, ['club_id', 'name', 'division', 'category'], editing ? [] : ['club_id', 'name', 'division']);
    const data = {};
    if (Object.hasOwn(input, 'club_id')) data.club_id = id(input.club_id);
    for (const field of ['name', 'category']) {
      if (Object.hasOwn(input, field)) data[field] = text(input[field], field === 'name' ? 100 : 50, true);
    }
    if (Object.hasOwn(input, 'division')) {
      if (!divisions.includes(input.division)) fail(400, 'INVALID_DIVISION');
      data.division = input.division;
    }
    const team = await transaction(pool, req.admin.userId, async client => {
      if (data.division) {
        const reference = await client.query('SELECT code FROM public.divisions WHERE code = $1 FOR SHARE', [data.division]);
        if (!reference.rows.length) fail(400, 'INVALID_DIVISION');
      }
      if (editing) {
        const existing = await client.query('SELECT club_id FROM public.teams WHERE id = $1 FOR UPDATE', [id(req.params.id)]);
        if (!existing.rows.length) fail(404, 'NOT_FOUND');
        if (data.club_id && data.club_id !== existing.rows[0].club_id) {
          const used = await client.query('SELECT 1 FROM public.ads WHERE team_id = $1 LIMIT 1', [id(req.params.id)]);
          if (used.rows.length) fail(409, 'RESOURCE_IN_USE');
        }
      }
      return editing ? update(client, 'teams', 'id', id(req.params.id), data) : insert(client, 'teams', data);
    });
    res.status(editing ? 200 : 201).json({ team });
  }
  router.post('/teams', saveTeam);
  router.patch('/teams/:id', saveTeam);
  router.delete('/teams/:id', async (req, res) => {
    await transaction(pool, req.admin.userId, async client => {
      const teamId = id(req.params.id);
      const existing = await client.query('SELECT id FROM public.teams WHERE id = $1 FOR UPDATE', [teamId]);
      if (!existing.rows.length) fail(404, 'NOT_FOUND');
      const used = await client.query('SELECT 1 FROM public.ads WHERE team_id = $1 LIMIT 1', [teamId]);
      if (used.rows.length) fail(409, 'RESOURCE_IN_USE');
      await client.query('DELETE FROM public.teams WHERE id = $1', [teamId]);
    });
    res.status(204).end();
  });

  // Version admin de la candidature : l'admin peut choisir annonce/joueur, le visiteur public ne peut pas tout choisir.
  async function saveApplication(req, res) {
    const editing = req.method === 'PATCH';
    const input = body(req.body, ['ad_id', 'player_id', 'name', 'email', 'phone', 'message'],
      editing ? [] : ['ad_id', 'name', 'email']);
    const data = {};
    if (Object.hasOwn(input, 'ad_id')) data.ad_id = id(input.ad_id);
    if (Object.hasOwn(input, 'player_id')) data.player_id = input.player_id == null ? null : id(input.player_id);
    if (Object.hasOwn(input, 'name')) data.name = text(input.name, 200, true);
    if (Object.hasOwn(input, 'email')) {
      const validation = validateUserUpdate({ email: input.email });
      if (validation.errors.email) fail(400, 'VALIDATION_ERROR', validation.errors);
      data.email = validation.data.email;
    }
    if (Object.hasOwn(input, 'phone')) data.phone = text(input.phone, 30);
    if (Object.hasOwn(input, 'message')) data.message = text(input.message, 2000) || '';
    const application = await transaction(pool, req.admin.userId, async client => editing
      ? update(client, 'applications', 'id', id(req.params.id), data) : insert(client, 'applications', data));
    res.status(editing ? 200 : 201).json({ application });
  }
  router.post('/applications', saveApplication);
  router.patch('/applications/:id', saveApplication);
  router.delete('/applications/:id', async (req, res) => {
    await transaction(pool, req.admin.userId, async client => {
      const result = await client.query('DELETE FROM public.applications WHERE id = $1 RETURNING id', [id(req.params.id)]);
      if (!result.rows.length) fail(404, 'NOT_FOUND');
    });
    res.status(204).end();
  });

  // Les codes restent les 14 postes et 14 divisions convenus. Les libellés et l'ordre sont modifiables.
  for (const table of ['positions', 'divisions']) {
    // Le code reste dans la liste convenue des 14 valeurs. Les labels/ordres se modifient sans inventer un code TOTO.
    async function saveCatalogue(req, res) {
      const editing = req.method === 'PATCH';
      const allowed = table === 'positions' ? ['label', 'sort_order'] : ['sort_order'];
      const input = body(req.body, editing ? allowed : ['code', ...allowed], editing ? [] : ['code', ...allowed]);
      const code = editing ? req.params.id : input.code;
      if (!(table === 'positions' ? playerPositions : divisions).includes(code)) fail(400, 'INVALID_CODE');
      const data = {};
      if (!editing) data.code = code;
      if (Object.hasOwn(input, 'label')) data.label = text(input.label, 100, true);
      if (Object.hasOwn(input, 'sort_order')) {
        if (!Number.isInteger(input.sort_order) || input.sort_order < 1 || input.sort_order > 32767) fail(400, 'INVALID_ORDER');
        data.sort_order = input.sort_order;
      }
      const result = await transaction(pool, req.admin.userId, client => editing
        ? update(client, table, 'code', code, data) : insert(client, table, data));
      res.status(editing ? 200 : 201).json({ [table.slice(0, -1)]: result });
    }
    router.post('/' + table, saveCatalogue);
    router.patch('/' + table + '/:id', saveCatalogue);
    router.delete('/' + table + '/:id', async (req, res) => {
      const code = req.params.id;
      if (!(table === 'positions' ? playerPositions : divisions).includes(code)) fail(400, 'INVALID_CODE');
      await transaction(pool, req.admin.userId, async client => {
        const existing = await client.query(`SELECT code FROM public.${table} WHERE code = $1 FOR UPDATE`, [code]);
        if (!existing.rows.length) fail(404, 'NOT_FOUND');
        const used = table === 'positions'
          ? await client.query('SELECT 1 FROM public.player_profiles WHERE $1 = ANY(positions) LIMIT 1', [code])
          : await client.query('SELECT 1 FROM public.teams WHERE division = $1 LIMIT 1', [code]);
        if (used.rows.length) fail(409, 'RESOURCE_IN_USE');
        // Les clés étrangères vérifient aussi ad_positions et ads.division_code.
        await client.query(`DELETE FROM public.${table} WHERE code = $1`, [code]);
      });
      res.status(204).end();
    });
  }
  return router;
}

module.exports = { createResourcesRouter };
