const express = require('express');

function createProfileRouter(pool, sessions) {
  const router = express.Router();

  router.get('/me', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!sessions) return res.status(503).json({ code: 'AUTH_NOT_CONFIGURED' });

    try {
      const identity = await sessions.authenticate(req);
      if (!identity) return res.status(401).json({ code: 'AUTH_REQUIRED' });
      if (!['PLAYER', 'CLUB'].includes(identity.role)) {
        return res.status(403).json({ code: 'ROLE_DENIED' });
      }

      // L'identifiant vient de la session, jamais d'un champ envoye par le front.
      const { rows } = await pool.query(`SELECT id, username, email FROM public.users WHERE id = $1`,
        [identity.userId]);
      if (!rows.length) return res.status(401).json({ code: 'AUTH_REQUIRED' });
      res.json({ user: { ...rows[0], role: identity.role } });
    } catch {
      res.status(503).json({ code: 'PROFILE_UNAVAILABLE' });
    }
  });

  return router;
}

module.exports = { createProfileRouter };
