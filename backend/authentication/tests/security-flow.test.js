const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes, createHash } = require('node:crypto');
const express = require('express');
const { createTestPool } = require('../../registration/tests/pool');
const { hashPassword, verifyPassword } = require('../../registration/password');
const { createRegistrationRouter } = require('../../registration/router');
const { createLoginRouter } = require('../router');
const { createSessionService } = require('../session');
const { createLogoutRouter } = require('../logout-router');
const { createResetRouter } = require('../reset-router');
const { requirePermission } = require('../permissions');
const { createSqlRateLimiter } = require('../rate-limit');
const { createLicenseRouter } = require('../../licenses/router');
const { createLicenseAdminRouter } = require('../../licenses/admin-router');
const { applyTestSecuritySchema } = require('./setup-security');
const pool = createTestPool();
const origin = 'https://mercasport.example';
const password = 'Une phrase de connexion de Joel !';
let server, base, sessions, queued = [], queueFailure = false, serial = 0;
const objects = new Map();
before(async () => {
  await applyTestSecuritySchema(pool);
  sessions = createSessionService(pool, { secret: randomBytes(32).toString('hex'), origins: [origin] });
  await pool.query(`INSERT INTO users(name,username,email,password_hash,role)
    VALUES('Flow Admin','Flow Admin','flow.admin@example.invalid',$1,'ADMIN')`, [await hashPassword(password)]);
  const app = express();
  app.use('/auth', createRegistrationRouter(pool));
  app.use('/auth', createLoginRouter(pool, { sessions, maxAttempts: 100 }));
  app.use('/auth', createLogoutRouter(sessions));
  app.use('/auth', createResetRouter(pool, { sessions, appOrigin: origin, enqueueResetLink: async job => {
    if (queueFailure) throw new Error('Test queue unavailable');
    queued.push(job); // TEST ONLY: no actual email sent.
  } }));
  app.use('/disabled', createResetRouter(pool, { sessions }));
  app.use('/players', createLicenseRouter(pool, { authenticate: sessions.authenticate, storage: {
    private: true, put: async ({ key, buffer }) => objects.set(key, buffer), remove: async key => objects.delete(key),
  }, onIncident: () => {} }));
  app.use('/admin', createLicenseAdminRouter(pool, { authenticate: sessions.authenticate, onIncident: () => {} }));
  app.get('/identity', requirePermission(sessions), (req, res) => res.json(res.locals.identity));
  app.get('/approved-player', requirePermission(sessions, { roles: ['PLAYER'], approved: true }), (req, res) => res.json({ ok: true }));
  app.get('/club-only', requirePermission(sessions, { roles: ['CLUB'] }), (req, res) => res.json({ ok: true }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => { await pool.query('DELETE FROM auth_rate_limits'); queued = []; queueFailure = false; });
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await pool.end(); });
const post = (route, body, cookie) => fetch(base + route, { method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const get = (route, cookie) => fetch(base + route, { headers: cookie ? { Cookie: cookie } : {} });
const cookieOf = response => response.headers.get('set-cookie')?.split(';')[0];
async function player() {
  serial++;
  const email = `flow.${serial}@example.invalid`;
  const result = await post('/auth/register', { email, username: `Flow Player ${serial}`, password, role: 'PLAYER',
    profile: { first_name: 'Joel', last_name: `Test ${serial}` } });
  assert.equal(result.status, 201);
  const id = (await result.json()).user.id;
  const response = await post('/auth/login', { identifier: email, password });
  assert.equal(response.status, 200);
  return { id, email, cookie: cookieOf(response) };
}
async function resetToken(email) {
  const response = await post('/auth/forgot-password', { email });
  assert.equal(response.status, 202);
  return queued.at(-1).link.split('#token=')[1];
}
const resetBody = token => ({ token, password: 'Ma nouvelle longue phrase de passe !', password_confirmation: 'Ma nouvelle longue phrase de passe !' });

test('TEST-01: register, login, upload, admin approval, permission, logout, reset and login again', async () => {
  const p = await player();
  assert.equal((await get('/approved-player', p.cookie)).status, 403);
  assert.equal((await get('/club-only', p.cookie)).status, 403);
  const form = new FormData();
  form.append('license', new Blob(['%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'], { type: 'application/pdf' }), 'licence.pdf');
  const upload = await fetch(base + '/players/license', { method: 'POST', headers: { Origin: origin, Cookie: p.cookie }, body: form });
  assert.equal(upload.status, 201);
  const verification = (await upload.json()).verification;
  const adminLogin = await post('/auth/login', { identifier: 'flow.admin@example.invalid', password });
  const adminCookie = cookieOf(adminLogin);
  const review = await fetch(`${base}/admin/licenses/${verification.id}`, { method: 'PATCH',
    headers: { Origin: origin, Cookie: adminCookie, 'Content-Type': 'application/json' }, body: '{"status":"APPROVED"}' });
  assert.equal(review.status, 200);
  assert.equal((await get('/approved-player', p.cookie)).status, 200);
  const logout = await post('/auth/logout', {}, p.cookie);
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await get('/identity', p.cookie)).status, 401);
  const token = await resetToken(p.email);
  const row = (await pool.query('SELECT token_hash FROM password_reset_tokens WHERE user_id=$1', [p.id])).rows[0];
  assert.notEqual(row.token_hash, token);
  assert.equal(row.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.equal((await post('/auth/reset-password', resetBody(token))).status, 200);
  assert.equal((await post('/auth/reset-password', resetBody(token))).status, 400);
  assert.equal((await post('/auth/login', { identifier: p.email, password })).status, 401);
  const next = await post('/auth/login', { identifier: p.email, password: resetBody(token).password });
  assert.equal(next.status, 200);
  assert.equal((await get('/approved-player', cookieOf(next))).status, 200);
});
test('logout revokes one session, preserves another and rejects a foreign origin', async () => {
  const p = await player();
  const other = cookieOf(await post('/auth/login', { identifier: p.email, password }));
  assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: p.cookie } })).status, 403);
  assert.equal((await post('/auth/logout', {}, p.cookie)).status, 204);
  assert.equal((await get('/identity', p.cookie)).status, 401);
  assert.equal((await get('/identity', other)).status, 200);
  assert.equal((await post('/auth/logout', {})).status, 204);
});
test('SQL limiter is shared and concurrent attempts cannot exceed its limit', async () => {
  const a = createSqlRateLimiter(pool, sessions.rateKey, { maxAttempts: 2 });
  const b = createSqlRateLimiter(pool, sessions.rateKey, { maxAttempts: 2 });
  const results = await Promise.all([a.allow('shared'), b.allow('shared'), a.allow('shared'), b.allow('shared')]);
  assert.equal(results.filter(Boolean).length, 2);
  await pool.query("UPDATE auth_rate_limits SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second'");
  assert.equal(await a.allow('shared'), true);
});
test('request gives same response for known/unknown account and unavailable delivery; no tokens exposed', async () => {
  const p = await player();
  const existing = await post('/auth/forgot-password', { email: p.email });
  const unknown = await post('/auth/forgot-password', { email: 'nobody@example.invalid' });
  assert.equal(existing.status, 202); assert.equal(unknown.status, 202);
  assert.deepEqual(await existing.json(), await unknown.json());
  assert.equal(queued.length, 1);
  queueFailure = true;
  assert.equal((await post('/auth/forgot-password', { email: p.email })).status, 202);
  assert.equal((await post('/disabled/forgot-password', { email: p.email })).status, 503);
  assert.equal((await post('/auth/forgot-password', { email: 'bad' })).status, 400);
});
test('expired link, changed token, weak password and mismatched confirmation rejected', async () => {
  const p = await player(); const token = await resetToken(p.email);
  assert.equal((await post('/auth/reset-password', { ...resetBody(token), password: 'court' })).status, 400);
  assert.equal((await post('/auth/reset-password', { ...resetBody(token), password_confirmation: 'Autre mot de passe' })).status, 400);
  assert.equal((await post('/auth/reset-password', resetBody(randomBytes(32).toString('base64url')))).status, 400);
  await pool.query(`UPDATE password_reset_tokens SET created_at=CURRENT_TIMESTAMP-INTERVAL '20 minutes',
    expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute' WHERE user_id=$1`, [p.id]);
  assert.equal((await post('/auth/reset-password', resetBody(token))).status, 400);
  assert.equal((await get('/identity', p.cookie)).status, 200);
});
test('concurrent use accepts a reset only once and revokes every session and other reset token', async () => {
  const p = await player();
  const otherSession = cookieOf(await post('/auth/login', { identifier: p.email, password }));
  const token = await resetToken(p.email); const otherToken = await resetToken(p.email);
  const responses = await Promise.all([post('/auth/reset-password', resetBody(token)), post('/auth/reset-password', resetBody(token))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200,400]);
  assert.equal((await post('/auth/reset-password', resetBody(otherToken))).status, 400);
  assert.equal((await get('/identity', p.cookie)).status, 401);
  assert.equal((await get('/identity', otherSession)).status, 401);
});
test('SQL failure cancels password change, token consumption and session revocation', async () => {
  const p = await player(); const token = await resetToken(p.email);
  await pool.query(`CREATE FUNCTION fail_reset_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Test rollback' USING ERRCODE='23514'; END $$`);
  await pool.query(`CREATE TRIGGER fail_reset_test BEFORE UPDATE OF revoked_at ON auth_sessions
    FOR EACH ROW EXECUTE FUNCTION fail_reset_test()`);
  try {
    assert.equal((await post('/auth/reset-password', resetBody(token))).status, 503);
    const hash = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [p.id])).rows[0].password_hash;
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal((await pool.query('SELECT used_at FROM password_reset_tokens WHERE user_id=$1', [p.id])).rows[0].used_at, null);
    assert.equal((await get('/identity', p.cookie)).status, 200);
  } finally {
    await pool.query('DROP TRIGGER fail_reset_test ON auth_sessions');
    await pool.query('DROP FUNCTION fail_reset_test()');
  }
});
test('club registration/login and role protection; migration can be reapplied', async () => {
  const result = await post('/auth/register', { email: 'flow.club@example.invalid', username: 'Flow Club', password,
    role: 'CLUB', profile: { name: 'FC Démo', city: 'Strasbourg' } });
  assert.equal(result.status, 201);
  const login = await post('/auth/login', { identifier: 'Flow Club', password });
  assert.equal(login.status, 200);
  const c = cookieOf(login);
  assert.equal((await get('/club-only', c)).status, 200);
  assert.equal((await get('/approved-player', c)).status, 403);
  await applyTestSecuritySchema(pool);
  assert.equal((await get('/club-only', c)).status, 200);
});
