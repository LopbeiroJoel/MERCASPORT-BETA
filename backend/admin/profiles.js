// REPERE ORAL - L'ADMIN PEUT EDITER LA FICHE D'UN COMPTE CIBLE.
// Ici :id vient de l'URL parce que l'admin a le droit de choisir un compte.
// C'est different de /profile/me, qui prend obligatoirement l'ID de la session.
// Je synchronise aussi players/clubs pour que les anciennes relations restent utilisables.

const express = require('express');
const { validateRegistration } = require('../registration/validation');
const { fail, id, body, text, transaction, update, insert, checkPositions } = require('./helpers');

const common = ['photo_url', 'biography', 'phone', 'location', 'email_visible', 'phone_visible', 'location_visible'];
const playerFields = ['first_name', 'last_name', 'birth_date', 'positions', 'preferred_foot', 'height_cm', 'current_club'];
const clubFields = ['name', 'city', 'divisions'];
const playerExtras = { past_clubs: 2000, experience: 2000, level: 100 };
const clubExtras = { description: 5000, general_info: 2000 };

// Je lis le compte pour savoir s'il faut ouvrir player_profiles ou club_profiles.
async function readProfile(client, userId, lock = false) {
  const account = await client.query(`SELECT id, upper(role) AS role, ${common.join(', ')}
    FROM public.users WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [userId]);
  if (!account.rows.length) fail(404, 'USER_NOT_FOUND');
  const user = account.rows[0];
  if (!['PLAYER', 'CLUB'].includes(user.role)) fail(400, 'PROFILE_ROLE_REQUIRED');
  const table = user.role === 'PLAYER' ? 'player_profiles' : 'club_profiles';
  const profile = await client.query(`SELECT * FROM public.${table} WHERE user_id = $1`, [userId]);
  return { user, table, profile: profile.rows[0] || null };
}

function createProfilesRouter(pool) {
  const router = express.Router();
  router.get('/users/:id/profile', async (req, res) => {
    const { user, profile } = await readProfile(pool, id(req.params.id));
    res.json({ user, profile });
  });

  // POST cree, PATCH exige une fiche existante, PUT cree ou met a jour selon l'etat actuel.
  async function saveProfile(req, res) {
    const userId = id(req.params.id);
    const result = await transaction(pool, req.admin.userId, async client => {
      const current = await readProfile(client, userId, true);
      const fields = current.user.role === 'PLAYER' ? playerFields : clubFields;
      const extras = current.user.role === 'PLAYER' ? playerExtras : clubExtras;
      const input = body(req.body, [...common, ...fields, ...Object.keys(extras)]);
      if (req.method === 'POST' && current.profile) fail(409, 'PROFILE_ALREADY_EXISTS');
      if (req.method === 'PATCH' && !current.profile) fail(404, 'PROFILE_NOT_FOUND');
      // Fusionner pour valider aussi les champs obligatoires d'un PATCH partiel.
      const merged = {};
      for (const field of fields) merged[field] = Object.hasOwn(input, field) ? input[field] : current.profile?.[field];
      if (merged.birth_date instanceof Date) merged.birth_date = merged.birth_date.toISOString().slice(0, 10);
      const validation = validateRegistration({ role: current.user.role, profile: merged });
      const profileErrors = Object.fromEntries(Object.entries(validation.errors).filter(([field]) => field.startsWith('profile')));
      if (Object.keys(profileErrors).length) fail(400, 'VALIDATION_ERROR', profileErrors);
      if (current.user.role === 'PLAYER') await checkPositions(client, validation.data.profile.positions);
      const data = {};
      for (const field of fields) {
        if (!current.profile || Object.hasOwn(input, field)) data[field] = validation.data.profile[field];
      }
      for (const [field, limit] of Object.entries(extras)) {
        if (Object.hasOwn(input, field)) data[field] = text(input[field], limit);
      }
      const account = {};
      for (const field of common) {
        if (!Object.hasOwn(input, field)) continue;
        if (field.endsWith('_visible')) {
          if (typeof input[field] !== 'boolean') fail(400, 'INVALID_VISIBILITY');
          account[field] = input[field];
        } else {
          account[field] = text(input[field], { photo_url: 2000, biography: 2000, phone: 30, location: 100 }[field]);
        }
      }
      if (account.photo_url && !/^\/(?!\/)/.test(account.photo_url)) {
        let url;
        try { url = new URL(account.photo_url); } catch { fail(400, 'INVALID_PHOTO_URL'); }
        if (!['https:', 'http:'].includes(url.protocol)) fail(400, 'INVALID_PHOTO_URL');
      }
      if (Object.keys(account).length) await update(client, 'users', 'id', userId, account, 'id');
      if (!current.profile) await insert(client, current.table, { user_id: userId, ...data });
      else if (Object.keys(data).length) await update(client, current.table, 'user_id', userId, data);
      const saved = await readProfile(client, userId);
      // Maintenir les anciennes tables utilisées par les annonces et candidatures.
      if (saved.user.role === 'PLAYER') {
        await client.query(`INSERT INTO public.players(user_id, first_name, last_name) VALUES ($1,$2,$3)
          ON CONFLICT (user_id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name`,
        [userId, saved.profile.first_name, saved.profile.last_name]);
      } else {
        await client.query(`INSERT INTO public.clubs(user_id, name, city, divisions) VALUES ($1,$2,$3,$4)
          ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, divisions = EXCLUDED.divisions`,
        [userId, saved.profile.name, saved.profile.city, saved.profile.divisions]);
      }
      return { user: saved.user, profile: saved.profile };
    });
    res.status(req.method === 'POST' ? 201 : 200).json(result);
  }
  router.post('/users/:id/profile', saveProfile);
  router.put('/users/:id/profile', saveProfile);
  router.patch('/users/:id/profile', saveProfile);

  // Ce DELETE retire la fiche, pas le compte users. Une candidature encore liee peut bloquer la suppression.
  router.delete('/users/:id/profile', async (req, res) => {
    await transaction(pool, req.admin.userId, async client => {
      const current = await readProfile(client, id(req.params.id), true);
      if (!current.profile) fail(404, 'PROFILE_NOT_FOUND');
      if (current.user.role === 'PLAYER') {
        // La FK des candidatures empêche une suppression si le joueur est utilisé.
        await client.query('DELETE FROM public.players WHERE user_id = $1', [current.user.id]);
      } else {
        const club = await client.query('SELECT id FROM public.clubs WHERE user_id = $1 FOR UPDATE', [current.user.id]);
        if (club.rows.length) {
          const dependencies = await client.query(`SELECT 1 FROM public.teams WHERE club_id = $1
            UNION ALL SELECT 1 FROM public.ads WHERE club_id = $1 LIMIT 1`, [club.rows[0].id]);
          if (dependencies.rows.length) fail(409, 'RESOURCE_IN_USE');
          await client.query('DELETE FROM public.clubs WHERE id = $1', [club.rows[0].id]);
        }
      }
      await client.query(`DELETE FROM public.${current.table} WHERE user_id = $1`, [current.user.id]);
    });
    res.status(204).end();
  });
  return router;
}

module.exports = { createProfilesRouter };
