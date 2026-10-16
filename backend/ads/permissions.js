function requireActiveClub(pool, sessions) {
  return async function (req, res, next) {
    res.set('Cache-Control', 'no-store');

    if (!sessions) {
      return res.status(503).json({ code: 'AUTH_NOT_CONFIGURED' });
    }

    try {
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        !sessions.allowsOrigin(req)
      ) {
        return res.status(403).json({ code: 'ORIGIN_DENIED' });
      }

      const identity = await sessions.authenticate(req);

      if (!identity) {
        return res.status(401).json({ code: 'AUTH_REQUIRED' });
      }

      if (identity.role !== 'CLUB') {
        return res.status(403).json({ code: 'CLUB_REQUIRED' });
      }

      if (identity.status !== 'ACTIVE') {
        return res.status(403).json({
          code: 'ACTIVE_ACCOUNT_REQUIRED'
        });
      }

      const { rows } = await pool.query(
        `SELECT c.id
         FROM public.clubs c
         JOIN public.users u ON u.id = c.user_id
         WHERE c.user_id = $1
           AND upper(u.role) = 'CLUB'
           AND u.status = 'ACTIVE'`,
        [identity.userId]
      );

      if (rows.length !== 1) {
        return res.status(403).json({ code: 'CLUB_ACCESS_DENIED' });
      }

      req.club = {
        userId: identity.userId,
        clubId: rows[0].id
      };
    } catch {
      return res.status(503).json({ code: 'AD_AUTH_UNAVAILABLE' });
    }

    next();
  };
}

module.exports = { requireActiveClub };
