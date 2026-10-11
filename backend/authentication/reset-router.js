const express = require('express');
const { randomBytes, createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { validateRegistration } = require('../registration/validation');
const { hashPassword } = require('../registration/password');
const { createSqlRateLimiter } = require('./rate-limit');
const digest = token => createHash('sha256').update(token).digest('hex');
const generic = { message: 'Si ce compte existe, les instructions de réinitialisation seront envoyées.' };
const validate = (email, password) => validateRegistration({ email, password, username: 'Reset Test',
  role: 'PLAYER', profile: { first_name: 'Reset', last_name: 'Test' } });

function createResetRouter(pool, { sessions, appOrigin, enqueueResetLink, onIncident = () => {} } = {}) {
  if (enqueueResetLink) {
    const url = new URL(appOrigin);
    if (url.origin !== appOrigin || url.protocol !== 'https:') throw new Error('Use a trusted HTTPS origin.');
    if (typeof enqueueResetLink !== 'function') throw new Error('Provide a durable delivery queue adapter.');
  }
  const router = express.Router();
  const limiter = sessions ? createSqlRateLimiter(pool, sessions.rateKey) : null;
  let active = 0;
  const report = code => { try { onIncident({ code }); } catch { /* diagnostic only */ } };
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  const guard = async (req, res, next) => {
    if (!sessions) return res.status(503).json({ code: 'AUTH_NOT_CONFIGURED' });
    if (!sessions.allowsOrigin(req)) return res.status(403).json({ code: 'ORIGIN_DENIED' });
    try {
      if (!await limiter.allow(`reset:ip:${req.ip}`)) {
        res.set('Retry-After', String(limiter.retryAfter));
        return res.status(429).json({ code: 'TOO_MANY_ATTEMPTS' });
      }
    } catch { return res.status(503).json({ code: 'AUTH_UNAVAILABLE' }); }
    if (!req.is('application/json')) return res.status(415).json({ code: 'JSON_REQUIRED' });
    next();
  };
  router.post('/forgot-password', guard, express.json({ limit: '4kb', strict: true }), async (req, res) => {
    if (!enqueueResetLink) return res.status(503).json({ code: 'RESET_DELIVERY_NOT_CONFIGURED' });
    const b = req.body;
    if (!b || Array.isArray(b) || typeof b !== 'object' || Object.keys(b).some(k => k !== 'email')) {
      return res.status(400).json({ code: 'INVALID_EMAIL' });
    }
    const validation = validate(b.email, 'Dummy password for validation !');
    if (validation.errors.email) return res.status(400).json({ code: 'INVALID_EMAIL' });
    const email = validation.data.email;
    const start = Date.now();
    try {
      const allowed = await limiter.allow(`reset:email:${email}`);
      if (allowed) {
        const { rows } = await pool.query('SELECT id,email FROM users WHERE lower(btrim(email))=$1 LIMIT 2', [email]);
        const token = randomBytes(32).toString('base64url');
        if (rows.length === 1) {
          await pool.query(`INSERT INTO password_reset_tokens(token_hash,user_id,expires_at)
            VALUES($1,$2,CURRENT_TIMESTAMP + INTERVAL '15 minutes')`, [digest(token), rows[0].id]);
          // Adapter must enqueue durably and return promptly. No actual mail provider is configured here.
          await enqueueResetLink({ email: rows[0].email, link: `${appOrigin}/reset-password#token=${token}` });
        }
      }
    } catch { report('RESET_REQUEST_FAILED'); }
    // Same public result for unknown accounts, throttled accounts and queue failures.
    await delay(Math.max(0, 500 - (Date.now() - start)));
    res.status(202).json(generic);
  });
  router.post('/reset-password', guard, express.json({ limit: '4kb', strict: true }), async (req, res) => {
    const b = req.body;
    if (!b || Array.isArray(b) || typeof b !== 'object' ||
        Object.keys(b).some(k => !['token', 'password', 'password_confirmation'].includes(k)) ||
        typeof b.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(b.token)) {
      return res.status(400).json({ code: 'INVALID_RESET_REQUEST' });
    }
    if (validate('reset@example.invalid', b.password).errors.password || b.password_confirmation !== b.password) {
      return res.status(400).json({ code: 'INVALID_NEW_PASSWORD' });
    }
    let client, transaction = false, commitStarted = false, broken = false, admitted = false;
    try {
      if (active >= 2) return res.status(503).json({ code: 'AUTH_BUSY' });
      active++; admitted = true;
      const tokenHash = digest(b.token);
      const lookup = await pool.query(`SELECT user_id FROM password_reset_tokens WHERE token_hash=$1
        AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP`, [tokenHash]);
      if (!lookup.rows.length) return res.status(400).json({ code: 'INVALID_OR_EXPIRED_RESET_TOKEN' });
      const userId = lookup.rows[0].user_id;
      const hash = await hashPassword(b.password);
      client = await pool.connect(); await client.query('BEGIN'); transaction = true;
      const user = await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if (!user.rows.length) throw new Error('Reset user missing');
      const token = await client.query(`SELECT user_id FROM password_reset_tokens WHERE token_hash=$1
        AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP FOR UPDATE`, [tokenHash]);
      if (!token.rows.length || token.rows[0].user_id !== userId) {
        await client.query('ROLLBACK'); transaction = false;
        return res.status(400).json({ code: 'INVALID_OR_EXPIRED_RESET_TOKEN' });
      }
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [userId, hash]);
      await client.query(`UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL`, [userId]);
      await client.query(`UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND revoked_at IS NULL`, [userId]);
      commitStarted = true; await client.query('COMMIT'); transaction = false;
      sessions.clear(res);
      res.json({ message: 'Mot de passe modifié. Connecte-toi avec ton nouveau mot de passe.' });
    } catch {
      if (transaction) await client.query('ROLLBACK').catch(() => { broken = true; });
      if (commitStarted) { broken = true; report('PASSWORD_RESET_COMMIT_UNCERTAIN'); }
      res.status(503).json({ code: 'AUTH_UNAVAILABLE' });
    } finally { client?.release(broken); if (admitted) active--; }
  });
  router.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ code: 'BODY_TOO_LARGE' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ code: 'INVALID_JSON' });
    next(error);
  });
  return router;
}
module.exports = { createResetRouter };
