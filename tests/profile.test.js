const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { configureApp } = require('../backend/app');
const { createSessionService } = require('../backend/authentication/session');
const { createTestPool } = require('../backend/registration/tests/pool');

const pool = createTestPool({ migrations: ['profile.sql', 'profile.sql'] });
const secret = '0123456789abcdef'.repeat(4); // Cle fictive de test.
const origin = 'https://mercasport.test';
const password = 'Une longue phrase pour mon compte profil !';
let server, base, player, club;

async function post(route, body, cookie, requestOrigin = origin, target = base) {
  return fetch(target + route, { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: requestOrigin,
    ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
}
async function login(identifier) {
  const response = await post('/auth/login', { identifier, password });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
async function me(cookie, query = '') {
  return fetch(base + '/profile/me' + query, { headers: cookie ? { Cookie: cookie } : {} });
}

before(async () => {
  const app = configureApp(express(), pool, { authSecret: secret, appOrigin: origin });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  for (const body of [
    { email: 'profil.player@example.invalid', username: 'Joueur Profil', password,
      role: 'PLAYER', profile: { first_name: 'Alex', last_name: 'Profil' } },
    { email: 'profil.club@example.invalid', username: 'Club Profil', password,
      role: 'CLUB', profile: { name: 'Club Profil', city: 'Strasbourg' } }
  ]) {
    const response = await post('/auth/register', body);
    assert.equal(response.status, 201);
    const data = await response.json();
    if (data.user.role === 'PLAYER') player = data.user;
    else club = data.user;
  }
});
beforeEach(async () => {
  await pool.query('DELETE FROM auth_rate_limits');
  await pool.query('DELETE FROM registration_rate_limits');
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

test('profil prive : une personne non connectee ne recoit aucune identite', async () => {
  const response = await me();
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: 'AUTH_REQUIRED' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('PLAYER : connexion, cookie protege et recuperation du bon compte', async () => {
  const response = await post('/auth/login', { identifier: player.email.toUpperCase(), password });
  assert.equal(response.status, 200);
  const cookieHeader = response.headers.get('set-cookie');
  assert.match(cookieHeader, /^__Host-mercasport_session=/);
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /Secure/i);
  assert.match(cookieHeader, /SameSite=Strict/i);
  const result = await me(cookieHeader.split(';')[0]);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { user: {
    id: player.id, username: player.username, email: player.email, role: 'PLAYER' } });
});

test('CLUB : la meme route fournit l’identite du club connecte', async () => {
  const cookie = await login('club profil');
  const response = await me(cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: {
    id: club.id, username: club.username, email: club.email, role: 'CLUB' } });
});

test('le client ne peut imposer ni un autre identifiant ni un autre role', async () => {
  const cookie = await login(player.username);
  const response = await me(cookie, `?user_id=${club.id}&role=CLUB`);
  const body = await response.json();
  assert.equal(body.user.id, player.id);
  assert.equal(body.user.role, 'PLAYER');
  assert.ok(!JSON.stringify(body).includes(password));
  assert.ok(!JSON.stringify(body).includes('password_hash'));
});

test('mauvais mot de passe, champs injectes et faux cookie refuses', async () => {
  assert.equal((await post('/auth/login', { identifier: player.email, password: 'incorrect' })).status, 401);
  assert.equal((await post('/auth/login', { identifier: player.email, password, role: 'ADMIN' })).status, 400);
  assert.equal((await me('__Host-mercasport_session=invente')).status, 401);
});

test('deconnexion : le cookie et la session SQL sont revoques', async () => {
  const cookie = await login(player.email);
  const response = await post('/auth/logout', {}, cookie);
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /Expires=/i);
  assert.equal((await me(cookie)).status, 401);
});

test('session expiree ou mot de passe change : le profil redevient inaccessible', async () => {
  const cookie = await login(club.email);
  await pool.query(`UPDATE auth_sessions SET expires_at = created_at - INTERVAL '1 hour',
    created_at = created_at - INTERVAL '2 hours' WHERE user_id = $1`, [club.id]);
  assert.equal((await me(cookie)).status, 401);
  const secondCookie = await login(player.email);
  const saved = await pool.query('SELECT password_hash FROM users WHERE id=$1', [player.id]);
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', ['hash-modifie-pour-test', player.id]);
  assert.equal((await me(secondCookie)).status, 401);
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [saved.rows[0].password_hash, player.id]);
});

test('autre origine refusee pour la connexion et la deconnexion', async () => {
  assert.equal((await post('/auth/login', { identifier: player.email, password }, null, 'https://evil.test')).status, 403);
  const cookie = await login(player.email);
  assert.equal((await post('/auth/logout', {}, cookie, 'https://evil.test')).status, 403);
  assert.equal((await me(cookie)).status, 200);
});

test('les anciens comptes bcrypt et leurs roles minuscules restent utilisables', async () => {
  const response = await post('/auth/login', {
    identifier: 'joel.player@mercasport.example', password: 'MercaSportDemo!2026' });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const profile = await me(cookie);
  assert.equal((await profile.json()).user.role, 'PLAYER');
});

test('limitation des tentatives de connexion : la onzieme est refusee', async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await post('/auth/login', { identifier: 'inconnu@example.invalid', password })).status, 401);
  }
  const response = await post('/auth/login', { identifier: player.email, password });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '900');
});

test('sans configuration : profil et login indisponibles, annonces toujours accessibles', async () => {
  const app = configureApp(express(), pool, { authSecret: '', appOrigin: '' });
  const other = app.listen(0, '127.0.0.1'); await once(other, 'listening');
  const target = `http://127.0.0.1:${other.address().port}`;
  try {
    assert.equal((await post('/auth/login', { identifier: player.email, password }, null, origin, target)).status, 503);
    assert.equal((await fetch(target + '/profile/me')).status, 503);
    assert.equal((await fetch(target + '/ads')).status, 200);
  } finally { await new Promise(resolve => other.close(resolve)); }
});

test('HTTP local autorise seulement pour le developpement ; autre domaine refuse', async () => {
  assert.throws(() => createSessionService(pool, { secret, origins: ['http://example.com'], allowLocalHttp: true }));
  assert.throws(() => createSessionService(pool, { secret, origins: ['http://localhost:3000'] }));
  const previousEnvironment = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => createSessionService(pool, { secret, origins: ['http://localhost:3000'], allowLocalHttp: true }));
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
  const local = createSessionService(pool, { secret, origins: ['http://localhost:3000'], allowLocalHttp: true });
  let name, options;
  const row = (await pool.query('SELECT * FROM users WHERE id=$1', [player.id])).rows[0];
  await local.issue(row, { cookie: (n, token, o) => { name = n; options = o; } });
  assert.equal(name, 'mercasport_session');
  assert.equal(options.secure, false);
  assert.equal(options.httpOnly, true);
});

test('la page commune et le formulaire de connexion sont servis par le meme serveur', async () => {
  const profile = await fetch(base + '/profile.html');
  assert.equal(profile.status, 200);
  assert.match(await profile.text(), /js\/profile\.mjs/);
  const loginPage = await fetch(base + '/login.html');
  assert.match(await loginPage.text(), /id="login-form"/);
  const avatar = await fetch(base + '/assets/default-avatar.svg');
  assert.equal(avatar.status, 200);
  assert.match(await avatar.text(), /<svg/);
});
