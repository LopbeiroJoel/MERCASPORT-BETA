const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { configureApp } = require('../backend/app');
const { createSessionService } = require('../backend/authentication/session');
const { createTestPool } = require('../backend/registration/tests/pool');

const pool = createTestPool({ migrations: ['profile.sql'] });
const secret = '0123456789abcdef'.repeat(4);
const origin = 'https://mercasport.test';
const sessions = createSessionService(pool, { secret, origins: [origin] });
const valid = { positions: ['STRIKER', 'RIGHT_WINGER'], division_code: 'R2', department: 'Haut-Rhin',
  city: 'Colmar', description: 'Un collectif motivé et trois entraînements par semaine.' };
let server, base, club, player, pendingClub, blockedClub;

async function account(role, status, suffix) {
  const { rows } = await pool.query(`INSERT INTO users (name,username,email,password_hash,role,status)
    VALUES ($1,$1,$2,$3,$4,$5) RETURNING *`, ['Compte Publication ' + suffix,
    `publication.${suffix}@example.invalid`, 'hash-isole-pour-session-de-test', role, status]);
  const user = rows[0];
  if (role === 'CLUB') {
    user.clubId = (await pool.query(`INSERT INTO clubs(user_id,name,city) VALUES($1,$2,$3) RETURNING id`,
      [user.id, 'Club Publication ' + suffix, 'Colmar'])).rows[0].id;
  }
  await sessions.issue(user, { cookie: (name, token) => { user.cookie = name + '=' + token; } });
  return user;
}

function publish(body = valid, user = club, options = {}) {
  return fetch((options.base || base) + '/ads', { method: 'POST', headers: {
    'Content-Type': options.type || 'application/json', Origin: options.origin || origin,
    ...(user ? { Cookie: user.cookie } : {}) }, body: options.raw ?? JSON.stringify(body) });
}

before(async () => {
  club = await account('CLUB', 'ACTIVE', 'club');
  player = await account('PLAYER', 'ACTIVE', 'player');
  pendingClub = await account('CLUB', 'PENDING', 'pending');
  blockedClub = await account('CLUB', 'BANNED', 'blocked');
  server = configureApp(express(), pool, { authSecret: secret, appOrigin: origin }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
});

test('les 14 postes et divisions du catalogue sont accessibles sans modifier les offres existantes', async () => {
  const response = await fetch(base + '/ads/options');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.positions.length, 14);
  assert.equal(data.divisions.length, 14);
  assert.ok(data.positions.some(p => p.code === 'STRIKER' && p.label === 'Buteur'));
  assert.deepEqual(data.departments, ['Bas-Rhin', 'Haut-Rhin']);
  assert.equal((await (await fetch(base + '/ads')).json()).length, 28);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('creation club : auteur issu de la session, plusieurs postes, annonce visible et anciennes conservees', async () => {
  const response = await publish();
  assert.equal(response.status, 201);
  const ad = await response.json();
  assert.equal(response.headers.get('location'), '/ads/' + ad.id);
  const row = (await pool.query('SELECT * FROM ads WHERE id=$1', [ad.id])).rows[0];
  assert.equal(row.author_id, club.id);
  assert.equal(row.club_id, club.clubId);
  assert.equal(row.team_id, null);
  assert.equal(row.position, 'Buteur');
  assert.equal(row.preferred_foot, null);
  assert.equal(row.status, 'PUBLISHED');
  assert.deepEqual((await pool.query('SELECT position_code FROM ad_positions WHERE ad_id=$1 ORDER BY position_code', [ad.id])).rows.map(r => r.position_code), ['RIGHT_WINGER', 'STRIKER']);
  const publicAd = await fetch(base + '/ads/' + ad.id);
  assert.equal(publicAd.status, 200);
  assert.equal((await publicAd.json()).division, 'R2');
  const list = await (await fetch(base + '/ads')).json();
  assert.equal(list.length, 29);
  assert.equal(list.filter(a => a.id <= 28).length, 28);
});

test('visiteur, joueur, club en attente, club banni et origine etrangere refuses', async () => {
  assert.equal((await publish(valid, null)).status, 401);
  assert.equal((await publish(valid, player)).status, 403);
  assert.equal((await publish(valid, pendingClub)).status, 403);
  assert.equal((await publish(valid, blockedClub)).status, 401);
  assert.equal((await publish(valid, club, { origin: 'https://autre.test' })).status, 403);
});

test('aucune possibilite de choisir un autre auteur ou club dans le formulaire', async () => {
  for (const extra of [{ author_id: player.id }, { club_id: pendingClub.clubId }, { user_id: player.id }, { status: 'PUBLISHED' }]) {
    assert.equal((await publish({ ...valid, ...extra })).status, 400);
  }
});

test('valeurs invalides refusees sans creer de lignes', async () => {
  const beforeCount = (await pool.query('SELECT count(*)::int AS n FROM ads')).rows[0].n;
  for (const changes of [{ positions: [] }, { positions: ['TOTO'] }, { positions: ['STRIKER', 'STRIKER'] },
    { positions: 'STRIKER' }, { division_code: 'D9' }, { department: '67' }, { city: ' ' },
    { description: '' }, { description: 'x'.repeat(5001) }, { salary: 'x'.repeat(101) }, { preferred_foot: 'RIGHT' }]) {
    const response = await publish({ ...valid, ...changes });
    assert.equal(response.status, 400, JSON.stringify(changes).slice(0, 100));
    assert.equal((await response.json()).code, 'VALIDATION_ERROR');
  }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ads')).rows[0].n, beforeCount);
});

test('JSON obligatoire, JSON mal forme et requete trop grande', async () => {
  assert.equal((await publish(valid, club, { type: 'text/plain' })).status, 415);
  assert.equal((await publish(valid, club, { raw: '{' })).status, 400);
  assert.equal((await publish(valid, club, { raw: JSON.stringify({ description: 'x'.repeat(17000) }) })).status, 413);
});

test('les champs facultatifs sont sauvegardes et les donnees restent traitees comme du texte', async () => {
  const description = '<script>alert(1)</script> Une description textuelle.';
  const response = await publish({ ...valid, description, preferred_foot: 'Deux pieds', salary: 'Frais remboursés',
    age_range: '18_25', experience_level: 'REGIONAL', trial_possible: true, additional_info: 'Essai le mercredi.' });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  const row = (await pool.query('SELECT * FROM ads WHERE id=$1', [id])).rows[0];
  assert.equal(row.description, description);
  assert.equal(row.trial_possible, true);
  assert.equal(row.preferred_foot, 'Deux pieds');
  assert.equal(row.salary, 'Frais remboursés');
});

test('catalogue change : references absentes refusees avant ecriture', async () => {
  const initial = (await pool.query('SELECT count(*)::int AS n FROM ads')).rows[0].n;
  const wrapped = { query: (...args) => pool.query(...args), connect: async () => {
    const client = await pool.connect();
    return { release: client.release, query: (sql, values) => sql.includes('SELECT code, label FROM public.positions')
      ? Promise.resolve({ rows: [] }) : client.query(sql, values) };
  } };
  const other = configureApp(express(), wrapped, { authSecret: secret, appOrigin: origin }).listen(0, '127.0.0.1');
  await once(other, 'listening');
  try {
    const response = await publish(valid, club, { base: `http://127.0.0.1:${other.address().port}` });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).fields.positions);
  } finally { await new Promise(resolve => other.close(resolve)); }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ads')).rows[0].n, initial);
});

test('erreur pendant la transaction : aucun enregistrement partiel et aucune fuite SQL', async () => {
  const initial = (await pool.query('SELECT count(*)::int AS n FROM ads')).rows[0].n;
  const wrapped = { query: (...args) => pool.query(...args), connect: async () => {
    const client = await pool.connect();
    return { release: client.release, query: (sql, values) => {
      if (sql.includes('INSERT INTO public.ad_positions')) throw new Error('detail prive de SQL');
      return client.query(sql, values);
    } };
  } };
  const other = configureApp(express(), wrapped, { authSecret: secret, appOrigin: origin }).listen(0, '127.0.0.1');
  await once(other, 'listening');
  try {
    const response = await publish(valid, club, { base: `http://127.0.0.1:${other.address().port}` });
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('detail prive'));
  } finally { await new Promise(resolve => other.close(resolve)); }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ads')).rows[0].n, initial);
});
