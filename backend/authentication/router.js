const express = require('express');
const { randomBytes } = require('node:crypto');
const { createSqlRateLimiter } = require('./rate-limit');
const bcrypt = require('bcryptjs');
const { hashPassword, verifyPassword } = require('../registration/password');
const { clientAddress } = require('../registration/rate-limit');

function createLoginRouter(pool, { sessions, maxAttempts = 10, windowMs = 15 * 60 * 1000 } = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error('Invalid login rate configuration');
  }
  const router = express.Router();
  const limiter = sessions ? createSqlRateLimiter(pool, sessions.rateKey, { maxAttempts, windowMs }) : null;
  let active = 0, dummy;
  router.post('/login', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!sessions) return res.status(503).json({ code: 'AUTH_NOT_CONFIGURED' });
    if (!sessions.allowsOrigin(req)) return res.status(403).json({ code: 'ORIGIN_DENIED' });
    let allowed;
    try { allowed = await limiter.allow(`login:ip:${clientAddress(req)}`); }
    catch { return res.status(503).json({ code: 'AUTH_UNAVAILABLE' }); }
    if (!allowed) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ code: 'TOO_MANY_ATTEMPTS' });
    }
    if (!req.is('application/json')) return res.status(415).json({ code: 'JSON_REQUIRED' });
    next();
  }, express.json({ limit: '4kb', strict: true }), async (req, res) => {
    let admitted = false;
    try {
      const b = req.body;
      if (!b || Array.isArray(b) || typeof b !== 'object' ||
          Object.keys(b).some(k => !['identifier', 'password'].includes(k)) ||
          typeof b.identifier !== 'string' || !b.identifier.trim() || b.identifier.length > 254 ||
          /[\u0000-\u001f\u007f]/.test(b.identifier) || typeof b.password !== 'string' ||
          !b.password || Array.from(b.password).length > 128 || Buffer.byteLength(b.password) > 512 ||
          /[\u0000-\u001f\u007f]/.test(b.password)) {
        return res.status(400).json({ code: 'INVALID_LOGIN_FIELDS' });
      }
      const identifier = b.identifier.trim().normalize('NFC').toLowerCase();
      if (!await limiter.allow(`login:account:${identifier}`)) {
        res.set('Retry-After', String(limiter.retryAfter));
        return res.status(429).json({ code: 'TOO_MANY_ATTEMPTS' });
      }
      if (active >= 2) return res.status(503).json({ code: 'AUTH_BUSY' });
      active++; admitted = true;
      if (!dummy) dummy = hashPassword(randomBytes(32).toString('hex')).catch(error => { dummy = null; throw error; });
      const dummyHash = await dummy;
      const field = identifier.includes('@') ? 'email' : 'username';
      const { rows } = await pool.query(`SELECT id,username,email,password_hash,role,is_verified,status,created_at
        FROM users WHERE lower(btrim(${field}))=$1 LIMIT 2`, [identifier]);
      const user = rows.length === 1 ? rows[0] : null;
      // Les anciens comptes utilisaient des roles en minuscules.
      if (user) user.role = user.role.toUpperCase();
      let valid;
      const stored = user?.password_hash || dummyHash;
      if (/^\$2[aby]\$(0[4-9]|1[0-4])\$[./A-Za-z0-9]{53}$/.test(stored)) {
        // bcrypt only processes 72 bytes. Reject oversized input rather than silently truncating it.
        valid = Buffer.byteLength(b.password) <= 72 && await bcrypt.compare(b.password, stored);
      } else if (/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/.test(stored) || stored.startsWith('scrypt$v1$131072$8$1$')) {
        valid = await verifyPassword(b.password, stored);
      } else {
        await verifyPassword(b.password, dummyHash); valid = false;
      }
      // Les comptes bloques ne peuvent pas ouvrir une nouvelle session.
      if (!user || !valid || ['BANNED', 'DISABLED'].includes(user.status)) return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Identifiant ou mot de passe incorrect.' });
      if (!['PLAYER', 'CLUB', 'ADMIN'].includes(user.role)) return res.status(401).json({ code: 'INVALID_CREDENTIALS' });
      await sessions.issue(user, res);
      const { password_hash, ...publicUser } = user;
      res.json({ user: publicUser });
    } catch {
      res.status(503).json({ code: 'AUTH_UNAVAILABLE' });
    } finally { if (admitted) active--; }
  });
  router.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ code: 'BODY_TOO_LARGE' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ code: 'INVALID_JSON' });
    next(error);
  });
  return router;
}
module.exports = { createLoginRouter };
