// REPERE ORAL - LA PORTE DU PANEL ADMIN (doc, section 12).
// Etre connecte ne suffit pas : permission ADMIN active + compte ACTIVE en SQL.
// Le lien Panel admin dans le HTML ne donne aucun droit. C'est cette verification qui compte.
// Le role joueur/club et la permission admin sont deux choses separees.

function requireAdmin(pool, sessions) {
  return async function (req, res, next) {
    res.set('Cache-Control', 'no-store');

    if (!sessions) {
      return res.status(503).json({
        code: 'AUTH_NOT_CONFIGURED'
      });
    }

    try {
      const identity = await sessions.authenticate(req);

      if (!identity) {
        return res.status(401).json({
          code: 'AUTH_REQUIRED'
        });
      }

      // Vérifier que le compte et ses droits ADMIN sont actifs.
      const { rows } = await pool.query(
        `SELECT p.role
         FROM public.admin_permissions p
         JOIN public.users u ON u.id = p.user_id
         WHERE p.user_id = $1
           AND p.is_active = TRUE
           AND u.status = 'ACTIVE'
           AND p.role = 'ADMIN'`,
        [identity.userId]
      );

      if (!rows.length) {
        return res.status(403).json({
          code: 'ADMIN_ACCESS_DENIED'
        });
      }

      req.admin = {
        userId: identity.userId,
        role: rows[0].role
      };

      next();
    } catch {
      return res.status(503).json({
        code: 'ADMIN_UNAVAILABLE'
      });
    }
  };
}

module.exports = { requireAdmin };