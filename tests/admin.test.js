const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { configureApp } = require('../backend/app');
const { createTestPool } = require('../backend/registration/tests/pool');
const { createSessionService } = require('../backend/authentication/session');
const { hashPassword } = require('../backend/registration/password');

let pool, server, base, sessions, adminCookie, memberCookie;
const origin = 'http://localhost:3000';
const secret = 'ab'.repeat(32);
const password = 'Phrase de test administrateur 2026';

async function cookieFor(id) {
  const user = (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  let cookie;
  await sessions.issue(user, { cookie: (name, value) => { cookie = name + '=' + value; } });
  return cookie;
}

function get(route, cookie = adminCookie) {
  return fetch(base + route, { headers: cookie ? { Cookie: cookie } : {} });
}

function post(route, body = { confirm: true }, cookie = adminCookie, requestOrigin = origin) {
  return fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
  });
}

before(async () => {
  // Base PostgreSQL jetable : ces tests ne se connectent jamais à Neon.
  pool = createTestPool({ migrations: ['profile.sql', 'profile-fields.sql'] });
  await pool.query("UPDATE users SET status='ACTIVE' WHERE id IN (1,2,4)");
  await pool.query("INSERT INTO admin_permissions(user_id,role) VALUES(1,'ADMIN')");
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=2', [await hashPassword(password)]);
  sessions = createSessionService(pool, { secret, origins: [origin], allowLocalHttp: true });
  adminCookie = await cookieFor(1);
  memberCookie = await cookieFor(4);
  server = configureApp(express(), pool, { authSecret: secret, appOrigin: origin }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
});

test('admin : visiteurs, comptes classiques et droits inactifs refuses', async () => {
  for (const route of ['/admin/me', '/admin/users', '/admin/ads', '/admin/administrators']) {
    assert.equal((await get(route, null)).status, 401);
    assert.equal((await get(route, memberCookie)).status, 403);
  }
  assert.equal((await post('/admin/users/2/ban', { confirm: true }, null)).status, 401);
  assert.equal((await post('/admin/ads/1/delete', { confirm: true }, memberCookie)).status, 403);
  await pool.query('UPDATE admin_permissions SET is_active=FALSE WHERE user_id=1');
  assert.equal((await get('/admin/users')).status, 403);
  await pool.query('UPDATE admin_permissions SET is_active=TRUE WHERE user_id=1');
});

test('admin : recherches utilisateurs et annonces, erreurs de saisie et liste des droits', async () => {
  const me = await get('/admin/me');
  assert.equal(me.status, 200);
  assert.deepEqual((await me.json()).admin, { userId: 1, role: 'ADMIN' });
  for (const route of ['/admin/users?search=1', '/admin/users?search=Hégenheim',
    '/admin/ads?search=Gardien', '/admin/ads?search=1', '/admin/administrators']) {
    assert.equal((await get(route)).status, 200);
  }
  assert.deepEqual((await (await get('/admin/users?search=Introuvable94721')).json()).users, []);
  assert.equal((await get('/admin/users?search=a&search=b')).status, 400);
  assert.equal((await get('/admin/ads?search=' + 'x'.repeat(101))).status, 400);
  assert.equal((await get('/admin/ads?search=%00')).status, 400);
});

test('sanctions : confirmation, identifiants et origine verifies ; administrateurs proteges', async () => {
  assert.equal((await post('/admin/users/2/ban', { confirm: false })).status, 400);
  assert.equal((await post('/admin/ads/1/delete', {})).status, 400);
  assert.equal((await post('/admin/users/abc/ban')).status, 400);
  assert.equal((await post('/admin/ads/0/delete')).status, 400);
  assert.equal((await post('/admin/users/2147483647/ban')).status, 404);
  assert.equal((await post('/admin/ads/2147483647/delete')).status, 404);
  assert.equal((await post('/admin/users/1/ban')).status, 403);
  const denied = await post('/admin/users/2/ban', { confirm: true }, adminCookie, 'https://autre-site.invalid');
  assert.ok([401,403].includes(denied.status));
  assert.equal((await pool.query('SELECT status FROM users WHERE id=2')).rows[0].status, 'ACTIVE');
});

test('bannissement : compte conserve, sessions revoquees, connexion et annonces bloquees', async () => {
  const target = (await pool.query('SELECT email FROM users WHERE id=2')).rows[0];
  const loginBefore = await post('/auth/login', { identifier: target.email, password }, null);
  assert.equal(loginBefore.status, 200);
  const targetCookie = loginBefore.headers.get('set-cookie').split(';')[0];
  const ads = (await pool.query('SELECT id FROM ads WHERE author_id=2 ORDER BY id')).rows;
  assert.ok(ads.length > 0);
  assert.equal((await get('/ads/' + ads[0].id, null)).status, 200);
  const response = await post('/admin/users/2/ban');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).user, { id: 2, status: 'BANNED' });
  const stored = (await pool.query('SELECT status,status_before_ban,banned_at FROM users WHERE id=2')).rows[0];
  assert.equal(stored.status_before_ban, 'ACTIVE');
  assert.ok(stored.banned_at);
  assert.equal((await get('/profile/me', targetCookie)).status, 401);
  assert.equal((await post('/auth/login', { identifier: target.email, password }, null)).status, 401);
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM auth_sessions WHERE user_id=2 AND revoked_at IS NULL')).rows[0].n), 0);
  const publicAds = await (await get('/ads', null)).json();
  assert.ok(publicAds.every(ad => !ads.some(hidden => hidden.id === ad.id)));
  assert.equal((await get('/ads/' + ads[0].id, null)).status, 404);
  assert.equal((await post('/applications', { ad_id: ads[0].id, name: 'Test', email: 'test@example.invalid' }, null)).status, 404);
  assert.equal((await post('/admin/users/2/ban')).status, 409);
  const log = (await pool.query("SELECT * FROM admin_actions WHERE action='BAN_USER' AND target_user_id=2")).rows;
  assert.equal(log.length, 1);
  assert.equal(log[0].admin_user_id, 1);
  assert.equal(log[0].reason, '');
});

test('suppression : annonce conservee en SQL, masquee au public et aux candidatures', async () => {
  const ad = (await pool.query('SELECT id FROM ads WHERE author_id=3 ORDER BY id LIMIT 1')).rows[0];
  const before = Number((await pool.query('SELECT count(*) AS n FROM ads')).rows[0].n);
  const response = await post('/admin/ads/' + ad.id + '/delete');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).ad, { id: ad.id, status: 'DELETED' });
  const stored = (await pool.query('SELECT status,deleted_at FROM ads WHERE id=$1', [ad.id])).rows[0];
  assert.equal(stored.status, 'DELETED');
  assert.ok(stored.deleted_at);
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM ads')).rows[0].n), before);
  assert.equal((await get('/ads/' + ad.id, null)).status, 404);
  assert.ok((await (await get('/ads', null)).json()).every(row => row.id !== ad.id));
  assert.equal((await post('/applications', { ad_id: ad.id, name: 'Test', email: 'test@example.invalid' }, null)).status, 404);
  const adminAds = await (await get('/admin/ads?search=' + ad.id)).json();
  assert.ok(adminAds.ads.some(row => row.id === ad.id && row.status === 'DELETED'));
  assert.equal((await post('/admin/ads/' + ad.id + '/delete')).status, 409);
  assert.equal((await pool.query("SELECT * FROM admin_actions WHERE action='DELETE_AD' AND target_ad_id=$1", [ad.id])).rows.length, 1);
});

test('transactions : une erreur du journal annule la sanction et la revocation des sessions', async () => {
  const cookie = await cookieFor(4);
  const ad = (await pool.query("SELECT id FROM ads WHERE status='PUBLISHED' AND author_id=3 ORDER BY id LIMIT 1")).rows[0];
  await pool.exec(`CREATE FUNCTION test_refuse_admin_log() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Erreur de test'; END $$;
    CREATE TRIGGER refuse_admin_log BEFORE INSERT ON admin_actions
    FOR EACH ROW EXECUTE FUNCTION test_refuse_admin_log();`);
  try {
    assert.equal((await post('/admin/users/4/ban')).status, 503);
    assert.equal((await pool.query('SELECT status FROM users WHERE id=4')).rows[0].status, 'ACTIVE');
    assert.equal((await get('/profile/me', cookie)).status, 200);
    assert.equal((await post('/admin/ads/' + ad.id + '/delete')).status, 503);
    assert.equal((await pool.query('SELECT status FROM ads WHERE id=$1', [ad.id])).rows[0].status, 'PUBLISHED');
  } finally {
    await pool.exec('DROP TRIGGER refuse_admin_log ON admin_actions; DROP FUNCTION test_refuse_admin_log();');
  }
});

test('page admin : HTML sans CSS, boutons branches et aucune donnee privee dans le HTML', async () => {
  const response = await get('/admin.html', null);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="panel" hidden/);
  assert.match(html, /js\/admin\.mjs/);
  assert.ok(!html.includes('stylesheet'));
  assert.ok(!html.includes('password_hash'));
});
