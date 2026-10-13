const express = require('express');
const { requireAdmin } = require('./permissions');

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
  const search = req.query.search ?? '';

  if (typeof search !== 'string' || search.length > 100) {
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
         AND (
           $1 = ''
           OR u.id::text = $1
           OR u.username ILIKE '%' || $1 || '%'
           OR u.email ILIKE '%' || $1 || '%'
           OR c.name ILIKE '%' || $1 || '%'
         )
       ORDER BY u.id DESC
       LIMIT 50`,
      [term]
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

  return router;
}

module.exports = { createAdminRouter };
