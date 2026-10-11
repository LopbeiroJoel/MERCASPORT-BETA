function requirePermission(sessions, { roles = ['PLAYER', 'CLUB', 'ADMIN'], approved = false } = {}) {
  if (!roles.length || roles.some(r => !['PLAYER', 'CLUB', 'ADMIN'].includes(r))) throw new Error('Invalid roles');
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      const identity = await sessions.authenticate(req);
      if (!identity) return res.status(401).json({ code: 'AUTH_REQUIRED' });
      if (!roles.includes(identity.role)) return res.status(403).json({ code: 'ROLE_DENIED' });
      if (approved && identity.status !== 'APPROVED') return res.status(403).json({ code: 'ACCOUNT_NOT_APPROVED' });
      res.locals.identity = identity;
      next();
    } catch { res.status(503).json({ code: 'AUTH_UNAVAILABLE' }); }
  };
}
module.exports = { requirePermission };
