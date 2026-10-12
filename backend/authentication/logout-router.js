const express = require('express');
function createLogoutRouter(sessions) {
  const router = express.Router();
  router.post('/logout', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!sessions) return res.status(503).json({ code: 'AUTH_NOT_CONFIGURED' });
    if (!sessions.allowsOrigin(req)) return res.status(403).json({ code: 'ORIGIN_DENIED' });
    try {
      await sessions.revoke(req);
      sessions.clear(res);
      res.status(204).end();
    } catch { res.status(503).json({ code: 'AUTH_UNAVAILABLE' }); }
  });
  return router;
}
module.exports = { createLogoutRouter };
