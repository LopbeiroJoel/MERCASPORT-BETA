const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { configureApp } = require('../backend/app');
const { createTestPool } = require('../backend/registration/tests/pool');
const { createSessionService } = require('../backend/authentication/session');

let pool, server, base, sessions, adminCookie, memberCookie;
const origin = 'http://localhost:3000';
const secret = 'ef'.repeat(32);

async function cookieFor(id) {
  let cookie;
  const user = (await pool.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
  await sessions.issue(user, { cookie: (name, value) => { cookie = name + '=' + value; } });
  return cookie;
}
function request(route, { method = 'GET', body, cookie = adminCookie, requestOrigin = origin,
  type = 'application/json', raw = false } = {}) {
  return fetch(base + route, { method,
    headers: { Origin: requestOrigin, 'Content-Type': type, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) });
}
function patch(body, id = '2', options = {}) {
  return request('/admin/users/' + id, { method: 'PATCH', body, ...options });
}
async function target() {
  return (await pool.query('SELECT id,name,username,email,role,status,is_verified FROM users WHERE id = 2')).rows[0];
}

before(async () => {
  // PostgreSQL jetable en mémoire : aucune lecture du .env ni connexion à Neon.
  pool = createTestPool({ migrations: ['profile.sql', 'profile-fields.sql'] });
  await pool.query("UPDATE users SET status = 'ACTIVE' WHERE id IN (1, 2, 3)");
  await pool.query("INSERT INTO admin_permissions(user_id, role) VALUES (1, 'ADMIN')");
  sessions = createSessionService(pool, { secret, origins: [origin], allowLocalHttp: true });
  adminCookie = await cookieFor(1);
  memberCookie = await cookieFor(2);
  server = configureApp(express(), pool, { authSecret: secret, appOrigin: origin }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
});

test('routes admin interdites sans session, avec faux cookie ou compte non admin', async () => {
  for (const route of ['/admin/me', '/admin/users', '/admin/users/2', '/admin/ads', '/admin/administrators']) {
    assert.equal((await request(route, { cookie: null })).status, 401);
    assert.equal((await request(route, { cookie: 'mercasport_session=faux' })).status, 401);
    assert.equal((await request(route, { cookie: memberCookie })).status, 403);
  }
  assert.equal((await patch({ username: 'Interdit' }, '2', { cookie: null })).status, 401);
  assert.equal((await patch({ username: 'Interdit' }, '2', { cookie: memberCookie })).status, 403);
});

test('droits inactifs et compte admin inactif refusés à chaque demande', async () => {
  await pool.query('UPDATE admin_permissions SET is_active = FALSE WHERE user_id = 1');
  assert.equal((await request('/admin/users/2')).status, 403);
  assert.equal((await patch({ username: 'Interdit' })).status, 403);
  await pool.query('UPDATE admin_permissions SET is_active = TRUE WHERE user_id = 1');
  for (const status of ['PENDING', 'BANNED', 'DISABLED']) {
    await pool.query('UPDATE users SET status = $1 WHERE id = 1', [status]);
    assert.ok([401, 403].includes((await request('/admin/me')).status));
  }
  await pool.query("UPDATE users SET status = 'ACTIVE' WHERE id = 1");
});

test('lecture et erreurs : aucun mot de passe, hash ou détail SQL exposé', async () => {
  const response = await request('/admin/users/2');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const { user } = await response.json();
  assert.equal(user.id, 2);
  assert.deepEqual(Object.keys(user).sort(), ['id', 'username', 'email', 'role', 'status', 'is_verified', 'created_at'].sort());
  assert.equal((await request('/admin/users/2147483647')).status, 404);
  for (const id of ['0', '-1', 'abc', '01', '2147483648', '1%20OR%201=1']) {
    assert.equal((await request('/admin/users/' + id)).status, 400);
    assert.equal((await patch({ username: 'Test valide' }, id)).status, 400);
  }
  assert.equal((await request('/admin/users?search=%00')).status, 400);
  assert.equal((await request('/admin/users?search=a&search=b')).status, 400);
});

test('modification : origine, JSON, champs autorisés et valeurs vérifiés sans écriture', async () => {
  const before = await target();
  assert.ok([401, 403].includes((await patch({ username: 'Interdit' }, '2', { requestOrigin: 'https://autre.invalid' })).status));
  assert.equal((await patch('texte', '2', { raw: true, type: 'text/plain' })).status, 415);
  assert.equal((await patch('{', '2', { raw: true })).status, 400);
  assert.equal((await patch({ username: 'x'.repeat(9000) })).status, 413);
  for (const body of [null, [], {}, { username: 12 }, { username: 'ab' },
    { username: 'x'.repeat(51) }, { username: '<script>' }, { username: 'ABC\u0000' },
    { email: null }, { email: 'test..test@example.com' }, { email: 'test@localhost' },
    { email: 'test@example.com@autre.com' }, { email: 'test@-example.com' },
    { role: 'ADMIN' }, { status: 'ACTIVE' }, { password_hash: 'faux' },
    { id: 1 }, { is_verified: true }, JSON.parse('{"__proto__": {"role": "ADMIN"}}')]) {
    assert.equal((await patch(body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(await target(), before);
});

test('pseudo : sauvegarde partielle, normalisation, compte cible uniquement', async () => {
  const before = await target();
  const other = (await pool.query('SELECT username FROM users WHERE id = 3')).rows[0].username;
  const response = await patch({ username: '  Joël Test  ' });
  assert.equal(response.status, 200);
  const { user } = await response.json();
  assert.equal(user.username, 'Joël Test');
  assert.equal(user.email, before.email);
  assert.equal(user.role, before.role);
  assert.ok(!('password_hash' in user));
  assert.equal((await target()).name, 'Joël Test');
  assert.equal((await pool.query('SELECT username FROM users WHERE id = 3')).rows[0].username, other);
  assert.equal((await patch({ username: 'Test' }, '2147483647')).status, 404);
});

test('e-mail : normalisation, vérification annulée et sessions du compte révoquées', async () => {
  await pool.query('UPDATE users SET is_verified = TRUE WHERE id = 2');
  const cookie = await cookieFor(2);
  const response = await patch({ email: '  Nouveau.Test@Example.com  ' });
  assert.equal(response.status, 200);
  const { user } = await response.json();
  assert.equal(user.email, 'nouveau.test@example.com');
  assert.equal(user.is_verified, false);
  assert.equal((await request('/profile/me', { cookie })).status, 401);
  assert.equal((await request('/admin/me')).status, 200);
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM auth_sessions WHERE user_id = 2 AND revoked_at IS NULL')).rows[0].n), 0);
  await pool.query('UPDATE users SET is_verified = TRUE WHERE id = 2');
  const unchangedCookie = await cookieFor(2);
  assert.equal((await patch({ email: user.email })).status, 200);
  assert.equal((await target()).is_verified, true);
  assert.equal((await request('/profile/me', { cookie: unchangedCookie })).status, 200);
});

test('doublons : conflit 409 et aucune modification partielle', async () => {
  const before = await target();
  const duplicate = (await pool.query('SELECT username, email FROM users WHERE id = 3')).rows[0];
  const cookie = await cookieFor(2);
  assert.equal((await patch({ username: duplicate.username.toUpperCase(), email: 'rollback@example.com' })).status, 409);
  assert.deepEqual(await target(), before);
  assert.equal((await patch({ email: duplicate.email.toUpperCase(), username: 'Autre pseudo' })).status, 409);
  assert.deepEqual(await target(), before);
  assert.equal((await request('/profile/me', { cookie })).status, 200);
});

test('transaction : une erreur de révocation annule aussi le changement d’e-mail', async () => {
  const before = await target();
  const cookie = await cookieFor(2);
  await pool.exec(`CREATE FUNCTION fail_session_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Détail SQL privé'; END $$;
    CREATE TRIGGER fail_session_revoke BEFORE UPDATE ON auth_sessions
    FOR EACH ROW EXECUTE FUNCTION fail_session_revoke();`);
  try {
    const response = await patch({ email: 'ne-pas-enregistrer@example.com' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'USER_UPDATE_UNAVAILABLE' });
    assert.deepEqual(await target(), before);
    assert.equal((await request('/profile/me', { cookie })).status, 200);
  } finally {
    await pool.exec('DROP TRIGGER fail_session_revoke ON auth_sessions; DROP FUNCTION fail_session_revoke();');
  }
});

test('droits révoqués entre authentification et écriture : modification refusée', async () => {
  const before = await target();
  const originalConnect = pool.connect;
  pool.connect = async () => {
    await pool.query('UPDATE admin_permissions SET is_active = FALSE WHERE user_id = 1');
    return originalConnect();
  };
  try {
    assert.equal((await patch({ username: 'Ne pas enregistrer' })).status, 403);
    assert.deepEqual(await target(), before);
  } finally {
    pool.connect = originalConnect;
    await pool.query('UPDATE admin_permissions SET is_active = TRUE WHERE user_id = 1');
  }
});

test('protections conservées : bannissement et suppression masquent les annonces', async () => {
  const cookie = await cookieFor(3);
  const ad = (await pool.query('SELECT id FROM ads WHERE author_id = 3 ORDER BY id LIMIT 1')).rows[0];
  assert.equal((await request('/admin/users/3/ban', { method: 'POST', body: { confirm: true } })).status, 200);
  assert.equal((await request('/profile/me', { cookie })).status, 401);
  assert.equal((await request('/ads/' + ad.id, { cookie: null })).status, 404);
  const other = (await pool.query("SELECT id FROM ads WHERE author_id = 2 AND status = 'PUBLISHED' ORDER BY id LIMIT 1")).rows[0];
  assert.equal((await request('/admin/ads/' + other.id + '/delete', { method: 'POST', body: { confirm: true } })).status, 200);
  assert.equal((await request('/ads/' + other.id, { cookie: null })).status, 404);
  assert.equal((await request('/applications', { method: 'POST', cookie: null,
    body: { ad_id: other.id, name: 'Test', email: 'security@example.invalid' } })).status, 404);
});
