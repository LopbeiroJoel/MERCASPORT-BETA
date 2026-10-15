const express = require('express');
const { requireAdmin } = require('./permissions');
const { validateUserUpdate } = require('./user-validation');
const { createUsersRouter } = require('./users');
const { createProfilesRouter } = require('./profiles');
const { createResourcesRouter } = require('./resources');
const { createAdminAdsRouter } = require('./ads');

function createAdminRouter(pool, sessions) {
  const router = express.Router();

  // Toutes les routes exigent des droits ADMIN actifs.
  router.use(requireAdmin(pool, sessions));

  router.get('/me', (req, res) => {
    res.json({
      admin: req.admin
    });
  });

  router.get('/administrators', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.id, u.username, u.email,
                p.role, p.is_active, p.created_at
         FROM public.admin_permissions p
         JOIN public.users u ON u.id = p.user_id
         ORDER BY p.created_at DESC, u.id DESC`
      );

      res.json({
        administrators: rows
      });
    } catch {
      res.status(503).json({
        code: 'ADMIN_LIST_UNAVAILABLE'
      });
    }
  });
router.get('/users', async (req, res) => {
  const role = req.query.role ?? '';
  if (typeof role !== 'string' || !['', 'PLAYER', 'CLUB'].includes(role)) {
    return res.status(400).json({ code: 'INVALID_ROLE_FILTER' });
  }
  const search = req.query.search ?? '';

  if (typeof search !== 'string' || search.length > 100 || search.includes('\u0000')) {
    return res.status(400).json({
      code: 'INVALID_SEARCH'
    });
  }

  try {
    const term = search.trim();

    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.email, u.role, u.status,
              c.name AS club_name
       FROM public.users u
       LEFT JOIN public.club_profiles c ON c.user_id = u.id
       WHERE upper(u.role) IN ('PLAYER', 'CLUB')
         AND ($2 = '' OR upper(u.role) = $2)
         AND (
           $1 = ''
           OR u.id::text = $1
           OR u.username ILIKE '%' || $1 || '%'
           OR u.email ILIKE '%' || $1 || '%'
           OR c.name ILIKE '%' || $1 || '%'
         )
       ORDER BY u.id DESC
       LIMIT 50`,
      [term, role]
    );

    res.json({
      users: rows
    });
  } catch {
    res.status(503).json({
      code: 'USER_SEARCH_UNAVAILABLE'
    });
  }
});
router.get('/ads', async (req, res) => {
  const search = req.query.search ?? '';

  if (
    typeof search !== 'string'
    || search.length > 100
    || search.includes('\u0000')
  ) {
    return res.status(400).json({
      code: 'INVALID_SEARCH'
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.status, a.created_at,
              a.author_id,
              u.username AS author_name,
              upper(u.role) AS author_role,
              c.name AS club_name
       FROM public.ads a
       LEFT JOIN public.users u ON u.id = a.author_id
       LEFT JOIN public.clubs c ON c.id = a.club_id
       WHERE (
         $1 = ''
         OR a.id::text = $1
         OR a.title ILIKE '%' || $1 || '%'
         OR u.username ILIKE '%' || $1 || '%'
         OR c.name ILIKE '%' || $1 || '%'
       )
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 50`,
      [search.trim()]
    );

    res.json({
      ads: rows
    });
  } catch {
    res.status(503).json({
      code: 'AD_SEARCH_UNAVAILABLE'
    });
  }
});
router.post(
  '/users/:id/ban',

  // Protéger l'action et demander une confirmation explicite.
  (req, res, next) => {
    if (!sessions.allowsOrigin(req)) {
      return res.status(403).json({
        code: 'ORIGIN_DENIED'
      });
    }

    if (!req.is('application/json')) {
      return res.status(415).json({
        code: 'JSON_REQUIRED'
      });
    }

    next();
  },

  express.json({ limit: '4kb' }),

  async (req, res) => {
    const userId = Number(req.params.id);

    if (
      !/^[1-9]\d*$/.test(req.params.id)
      || !Number.isSafeInteger(userId)
      || userId > 2147483647
    ) {
      return res.status(400).json({
        code: 'INVALID_USER_ID'
      });
    }

    if (
      !req.body
      || Array.isArray(req.body)
      || req.body.confirm !== true
      || Object.keys(req.body).some(key => key !== 'confirm')
    ) {
      return res.status(400).json({
        code: 'CONFIRMATION_REQUIRED'
      });
    }

    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      // Verrouiller le compte pendant la sanction.
      const { rows } = await client.query(
        `SELECT u.id, u.role, u.status,
                EXISTS (
                  SELECT 1
                  FROM public.admin_permissions p
                  WHERE p.user_id = u.id
                ) AS is_admin
         FROM public.users u
         WHERE u.id = $1
         FOR UPDATE OF u`,
        [userId]
      );

      const user = rows[0];

      if (!user) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          code: 'USER_NOT_FOUND'
        });
      }

      // Ne pas utiliser cette route pour sanctionner un administrateur.
      if (
        user.is_admin
        || !['PLAYER', 'CLUB'].includes(user.role.toUpperCase())
        || user.id === req.admin.userId
      ) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          code: 'ADMIN_ACCOUNT_PROTECTED'
        });
      }

      if (user.status === 'BANNED') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'USER_ALREADY_BANNED'
        });
      }

      await client.query(
        `UPDATE public.users
         SET status_before_ban = status,
             status = 'BANNED',
             banned_at = CURRENT_TIMESTAMP,
             ban_reason = NULL
         WHERE id = $1`,
        [userId]
      );

      await client.query(
        `UPDATE public.auth_sessions
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE user_id = $1
           AND revoked_at IS NULL`,
        [userId]
      );

      // Aucun motif obligatoire : utiliser la valeur vide par défaut.
      await client.query(
        `INSERT INTO public.admin_actions
           (admin_user_id, action, target_user_id)
         VALUES ($1, 'BAN_USER', $2)`,
        [req.admin.userId, userId]
      );

      await client.query('COMMIT');

      res.json({
        user: {
          id: userId,
          status: 'BANNED'
        }
      });
    } catch {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }

      res.status(503).json({
        code: 'BAN_UNAVAILABLE'
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);
  // Suppression logique : conserver l'annonce dans Neon.
  router.post('/ads/:id/delete', (req, res, next) => {
    if (!sessions.allowsOrigin(req)) return res.status(403).json({ code: 'ORIGIN_DENIED' });
    if (!req.is('application/json')) return res.status(415).json({ code: 'JSON_REQUIRED' });
    next();
  }, express.json({ limit: '4kb' }), async (req, res) => {
    const adId = Number(req.params.id);
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(adId) || adId > 2147483647) {
      return res.status(400).json({ code: 'INVALID_AD_ID' });
    }
    if (!req.body || Array.isArray(req.body) || req.body.confirm !== true
        || Object.keys(req.body).some(key => key !== 'confirm')) {
      return res.status(400).json({ code: 'CONFIRMATION_REQUIRED' });
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT id, status FROM public.ads WHERE id=$1 FOR UPDATE', [adId]);
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ code: 'AD_NOT_FOUND' });
      }
      if (rows[0].status === 'DELETED') {
        await client.query('ROLLBACK');
        return res.status(409).json({ code: 'AD_ALREADY_DELETED' });
      }
      await client.query(`UPDATE public.ads SET status='DELETED', deleted_at=CURRENT_TIMESTAMP,
        deletion_reason=NULL WHERE id=$1`, [adId]);
      await client.query(`INSERT INTO public.admin_actions (admin_user_id,action,target_ad_id)
        VALUES ($1,'DELETE_AD',$2)`, [req.admin.userId,adId]);
      await client.query('COMMIT');
      res.json({ ad: { id: adId, status: 'DELETED' } });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      res.status(503).json({ code: 'DELETE_AD_UNAVAILABLE' });
    } finally {
      if (client) client.release();
    }
  });

router.get('/users/:id', async (req, res) => {
  const userId = Number(req.params.id);

  if (
    !/^[1-9]\d*$/.test(req.params.id) ||
    !Number.isSafeInteger(userId) ||
    userId > 2147483647
  ) {
    return res.status(400).json({
      code: 'INVALID_USER_ID'
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, role, status,
              is_verified, created_at
       FROM public.users
       WHERE id = $1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({
        code: 'USER_NOT_FOUND'
      });
    }

    return res.json({
      user: rows[0]
    });
  } catch {
    return res.status(503).json({
      code: 'USER_UNAVAILABLE'
    });
  }
});

  // Modifier uniquement le pseudo et l'e-mail, jamais le rôle ou les droits.
  router.patch('/users/:id', (req, res, next) => {
    if (!sessions.allowsOrigin(req)) return res.status(403).json({ code: 'ORIGIN_DENIED' });
    if (!req.is('application/json')) return res.status(415).json({ code: 'JSON_REQUIRED' });
    next();
  }, express.json({ limit: '8kb' }), async (req, res) => {
    const userId = Number(req.params.id);
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(userId) || userId > 2147483647) {
      return res.status(400).json({ code: 'INVALID_USER_ID' });
    }
    const { data, errors } = validateUserUpdate(req.body);
    if (Object.keys(errors).length) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', fields: errors });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      // Revérifier les droits dans la transaction pour empêcher une révocation contournée.
      const permission = await client.query(`SELECT p.user_id
        FROM public.admin_permissions p JOIN public.users u ON u.id = p.user_id
        WHERE p.user_id = $1 AND p.role = 'ADMIN' AND p.is_active = TRUE AND u.status = 'ACTIVE'
        FOR SHARE OF p, u`, [req.admin.userId]);
      if (!permission.rows.length) {
        await client.query('ROLLBACK');
        return res.status(403).json({ code: 'ADMIN_ACCESS_DENIED' });
      }

      const existing = await client.query('SELECT email FROM public.users WHERE id = $1 FOR UPDATE', [userId]);
      if (!existing.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ code: 'USER_NOT_FOUND' });
      }

      const columns = Object.keys(data);
      const values = columns.map(field => data[field]);
      // Les noms de colonnes viennent uniquement de la liste autorisée du validateur.
      const assignments = columns.map((field, i) => `${field} = $${i + 1}`);
      if (Object.hasOwn(data, 'username')) {
        assignments.push(`name = $${columns.indexOf('username') + 1}`);
      }
      const emailChanged = Object.hasOwn(data, 'email') && data.email !== existing.rows[0].email;
      if (emailChanged) assignments.push('is_verified = FALSE');
      values.push(userId);
      const { rows } = await client.query(`UPDATE public.users SET ${assignments.join(', ')}
        WHERE id = $${values.length}
        RETURNING id, username, email, role, status, is_verified`, values);

      // Fermer les sessions si l'adresse de connexion est modifiée.
      if (emailChanged) {
        await client.query(`UPDATE public.auth_sessions SET revoked_at = CURRENT_TIMESTAMP
          WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      }
      await client.query('COMMIT');
      return res.json({ user: rows[0] });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') {
        return res.status(409).json({ code: 'ACCOUNT_CONFLICT',
          message: 'Cet e-mail ou ce pseudo est déjà utilisé.' });
      }
      return res.status(503).json({ code: 'USER_UPDATE_UNAVAILABLE' });
    } finally {
      if (client) client.release();
    }
  });

  // Les nouvelles routes restent derrière requireAdmin et le contrôle d'origine.
  router.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!sessions.allowsOrigin(req)) return res.status(403).json({ code: 'ORIGIN_DENIED' });
    if (req.method !== 'DELETE' && !req.is('application/json')) {
      return res.status(415).json({ code: 'JSON_REQUIRED' });
    }
    next();
  }, express.json({ limit: '16kb' }));
  router.use(createUsersRouter(pool));
  router.use(createProfilesRouter(pool));
  router.use(createResourcesRouter(pool));
  router.use(createAdminAdsRouter(pool));

  router.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ code: 'INVALID_JSON' });
    if (error.type === 'entity.too.large') return res.status(413).json({ code: 'BODY_TOO_LARGE' });
    if (error.status && error.code) {
      return res.status(error.status).json({ code: error.code, ...(error.fields ? { fields: error.fields } : {}) });
    }
    if (error.code === '23505') return res.status(409).json({ code: 'RESOURCE_CONFLICT' });
    if (error.code === '23001') return res.status(409).json({ code: 'RESOURCE_IN_USE' });
    if (error.code === '23503') return res.status(req.method === 'DELETE' ? 409 : 400).json({ code: 'RESOURCE_IN_USE_OR_MISSING' });
    if (['23514', '23502', '22001', '22P02', '22007', '22008', 'P0001'].includes(error.code)) {
      return res.status(400).json({ code: 'INVALID_DATA' });
    }
    if (error.code === 'HASH_BUSY') return res.set('Retry-After', '5').status(503).json({ code: 'ADMIN_BUSY' });
    console.error('Erreur admin :', error.code || error.name);
    return res.status(503).json({ code: 'ADMIN_UNAVAILABLE' });
  });

  return router;
}

module.exports = { createAdminRouter };
