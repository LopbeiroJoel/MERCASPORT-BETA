const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { configureApp } = require('../backend/app');
const { createSessionService } = require('../backend/authentication/session');
const { createTestPool } = require('../backend/registration/tests/pool');

const pool = createTestPool({ migrations: ['profile.sql', 'profile.sql', 'profile-fields.sql', 'profile-fields.sql'] });
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
  const data = await result.json();
  assert.equal(data.user.id, player.id);
  assert.equal(data.user.email, player.email);
  assert.equal(data.user.role, 'PLAYER');
  assert.equal(data.profile.first_name, 'Alex');
  assert.equal(data.user.phone_visible, false);
});

test('CLUB : la meme route fournit l’identite du club connecte', async () => {
  const cookie = await login('club profil');
  const response = await me(cookie);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.user.id, club.id);
  assert.equal(data.user.role, 'CLUB');
  assert.equal(data.profile.name, 'Club Profil');
  assert.equal(data.profile.city, 'Strasbourg');
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

test('sans configuration : profil et login indisponibles, annonces existantes conservees', async () => {
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


async function patch(body, cookie, requestOrigin = origin) {
  return fetch(base + '/profile/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: requestOrigin,
      ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
  });
}

test('sauvegarde joueur : persistance, champs absents conserves et autre compte intact', async () => {
  const cookie = await login(player.email);
  const beforeClub = (await pool.query('SELECT biography,phone,location FROM users WHERE id=$1', [club.id])).rows[0];
  const response = await patch({ biography: 'Gardien de test', phone: '0600000000',
    location: 'Mulhouse', phone_visible: true }, cookie);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.user.id, player.id);
  assert.equal(data.user.biography, 'Gardien de test');
  assert.equal(data.user.phone_visible, true);
  assert.equal(data.user.email_visible, false);
  assert.ok(!JSON.stringify(data).includes('password_hash'));
  const read = await me(cookie);
  assert.equal((await read.json()).user.location, 'Mulhouse');
  const cleared = await patch({ biography: '', phone_visible: false }, cookie);
  assert.equal(cleared.status, 200);
  const saved = (await cleared.json()).user;
  assert.equal(saved.biography, '');
  assert.equal(saved.phone, '0600000000');
  assert.equal(saved.phone_visible, false);
  assert.deepEqual((await pool.query('SELECT biography,phone,location FROM users WHERE id=$1', [club.id])).rows[0], beforeClub);
});

test('sauvegarde club : meme API, compte et fiche club conserves', async () => {
  const cookie = await login(club.email);
  const response = await patch({ biography: 'Club de test', location: 'Colmar' }, cookie);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, club.id);
  const result = await me(cookie);
  assert.equal((await result.json()).profile.name, 'Club Profil');
});

test('modification refusee sans session, depuis une autre origine ou avec id injecte', async () => {
  assert.equal((await patch({ biography: 'test' })).status, 401);
  const cookie = await login(player.email);
  assert.equal((await patch({ biography: 'test' }, cookie, 'https://evil.test')).status, 403);
  assert.equal((await patch({ id: club.id, biography: 'injection' }, cookie)).status, 400);
  assert.equal((await patch({ role: 'ADMIN' }, cookie)).status, 400);
});

test('valeurs invalides refusees sans ecriture', async () => {
  const cookie = await login(player.email);
  const before = (await pool.query('SELECT biography,phone,location FROM users WHERE id=$1', [player.id])).rows[0];
  for (const body of [{}, [], null, { phone: 123 }, { phone: 'x'.repeat(31) },
    { biography: 'x'.repeat(2001) }, { location: 'x'.repeat(101) },
    { email_visible: 'false' }, { biography: '\u0000' }]) {
    assert.equal((await patch(body, cookie)).status, 400);
  }
  assert.deepEqual((await pool.query('SELECT biography,phone,location FROM users WHERE id=$1', [player.id])).rows[0], before);
});

test('formulaire Thomas servi au bon endroit avec les deux roles et les 15 postes', async () => {
  const response = await fetch(base + '/register.html');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /value="PLAYER"/);
  assert.match(html, /value="CLUB"/);
  assert.match(html, /js\/register\.js/);
  assert.equal((html.match(/name="positions"/g) || []).length, 15);
  assert.ok(!html.includes('value="STRIKER"'));
});
