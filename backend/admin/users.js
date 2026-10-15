const express = require('express');
const { deleteUser } = require('./deletion');
const { validateRegistration } = require('../registration/validation');
const { hashPassword } = require('../registration/password');
const { fail, id, body, transaction, insert, checkPositions } = require('./helpers');

const publicUser = 'id, username, email, role, status, is_verified, created_at';

function createUsersRouter(pool) {
  const router = express.Router();

  router.post('/users', async (req, res) => {
    const { errors, data } = validateRegistration(req.body);
    if (Object.keys(errors).length) fail(400, 'VALIDATION_ERROR', errors);
    const passwordHash = await hashPassword(data.password);
    const result = await transaction(pool, req.admin.userId, async client => {
      if (data.role === 'PLAYER') await checkPositions(client, data.profile.positions);
      const user = await insert(client, 'users', { name: data.username, username: data.username,
        email: data.email, password_hash: passwordHash, role: data.role, is_verified: false }, publicUser);
      const profile = await insert(client, data.role === 'PLAYER' ? 'player_profiles' : 'club_profiles',
        { user_id: user.id, ...data.profile });
      if (data.role === 'PLAYER') {
        await client.query(`INSERT INTO public.players(user_id, first_name, last_name)
          VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING`,
        [user.id, profile.first_name, profile.last_name]);
      } else {
        await client.query(`INSERT INTO public.clubs(user_id, name, city, divisions)
          VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO NOTHING`,
        [user.id, profile.name, profile.city, profile.divisions]);
      }
      return { user, profile };
    });
    res.location('/admin/users/' + result.user.id).status(201).json(result);
  });

  // Le statut est une ressource du compte. Ne change jamais le rôle ni les droits admin.
  async function setStatus(req, res, status) {
    const userId = id(req.params.id);
    const user = await transaction(pool, req.admin.userId, async client => {
      const existing = await client.query(`SELECT u.id, u.status, u.role,
        EXISTS(SELECT 1 FROM public.admin_permissions p WHERE p.user_id = u.id) AS is_admin
        FROM public.users u WHERE u.id = $1 FOR UPDATE OF u`, [userId]);
      if (!existing.rows.length) fail(404, 'USER_NOT_FOUND');
      const current = existing.rows[0];
      if (current.is_admin || current.role.toUpperCase() === 'ADMIN' || userId === req.admin.userId) {
        fail(403, 'ADMIN_ACCOUNT_PROTECTED');
      }
      await client.query(`UPDATE public.users SET status = $1::text,
        banned_at = CASE WHEN $1::text = 'BANNED' THEN CURRENT_TIMESTAMP ELSE NULL END,
        ban_reason = NULL WHERE id = $2`, [status, userId]);
      await client.query(`UPDATE public.auth_sessions SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      return (await client.query(`SELECT ${publicUser} FROM public.users WHERE id = $1`, [userId])).rows[0];
    });
    res.json({ user });
  }

  router.patch('/users/:id/status', async (req, res) => {
    const value = body(req.body, ['status'], ['status']).status;
    if (!['PENDING', 'ACTIVE', 'BANNED', 'DISABLED'].includes(value)) fail(400, 'INVALID_STATUS');
    await setStatus(req, res, value);
  });
  router.delete('/users/:id', async (req, res) => {
    await transaction(pool, req.admin.userId, client => deleteUser(client, id(req.params.id), req.admin.userId));
    res.status(204).end();
  });

  router.patch('/users/:id/verification', async (req, res) => {
    const userId = id(req.params.id);
    const input = body(req.body, ['is_verified'], ['is_verified']);
    if (typeof input.is_verified !== 'boolean') fail(400, 'INVALID_VERIFICATION');
    const user = await transaction(pool, req.admin.userId, async client => {
      const result = await client.query(`UPDATE public.users SET is_verified = $1
        WHERE id = $2 RETURNING id, username, email, role, status, is_verified`, [input.is_verified, userId]);
      if (!result.rows.length) fail(404, 'USER_NOT_FOUND');
      return result.rows[0];
    });
    res.json({ user });
  });
  router.put('/users/:id/password', async (req, res) => {
    const userId = id(req.params.id);
    const password = body(req.body, ['password'], ['password']).password;
    // Réutiliser la règle de mot de passe de l'inscription, sans modifier les autres champs.
    const validation = validateRegistration({ password });
    if (validation.errors.password) fail(400, 'VALIDATION_ERROR', { password: validation.errors.password });
    const hash = await hashPassword(password);
    await transaction(pool, req.admin.userId, async client => {
      const result = await client.query('UPDATE public.users SET password_hash = $1 WHERE id = $2 RETURNING id', [hash, userId]);
      if (!result.rows.length) fail(404, 'USER_NOT_FOUND');
      await client.query('UPDATE public.auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    });
    res.status(204).end();
  });
  return router;
}

module.exports = { createUsersRouter };
