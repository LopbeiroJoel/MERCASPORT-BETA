const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { configureApp } = require('../backend/app');
const { createSessionService } = require('../backend/authentication/session');
const { createTestPool } = require('../backend/registration/tests/pool');
const pool = createTestPool({ migrations: ['profile.sql', 'profile-fields.sql'] });
const secret = '0123456789abcdef'.repeat(4);
const origin = 'https://mercasport.test';
const sessions = createSessionService(pool, { secret, origins: [origin] });
let server, base, player, other, club;

async function account(role, name) {
  const { rows } = await pool.query(`INSERT INTO users(name,username,email,password_hash,role,status)
    VALUES($1,$1,$2,'hash-session-test',$3,'ACTIVE') RETURNING *`, [name, name.toLowerCase() + '@example.invalid', role]);
  const user = rows[0];
  if (role === 'PLAYER') await pool.query(`INSERT INTO player_profiles(user_id,first_name,last_name,positions,current_club)
    VALUES($1,'Alex','Joueur',ARRAY['STRIKER'],'Club de départ')`, [user.id]);
  else await pool.query(`INSERT INTO club_profiles(user_id,name,city) VALUES($1,'Club test','Colmar')`, [user.id]);
  await sessions.issue(user, { cookie: (name, token) => { user.cookie = name + '=' + token; } });
  return user;
}
function patch(body, user = player, requestOrigin = origin, target = base) {
  return fetch(target + '/profile/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: requestOrigin,
    ...(user ? { Cookie: user.cookie } : {}) }, body: JSON.stringify(body) });
}
async function read(user = player) {
  return (await fetch(base + '/profile/me', { headers: { Cookie: user.cookie } })).json();
}
before(async () => {
  player = await account('PLAYER', 'JoueurFiche');
  other = await account('PLAYER', 'AutreFiche');
  club = await account('CLUB', 'ClubFiche');
  server = configureApp(express(), pool, { authSecret: secret, appOrigin: origin }).listen(0, '127.0.0.1');
  await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await pool.end(); });

test('fiche personnelle : enregistrement complet puis lecture, sans toucher au second joueur', async () => {
  const beforeOther = await read(other);
  const response = await patch({ biography: 'Ma présentation', photo_url: 'https://example.invalid/photo.jpg',
    profile: { positions: ['GOALKEEPER', 'STRIKER'], preferred_foot: 'BOTH', current_club: 'Nouveau Club',
      past_clubs: 'Club A\nClub B', experience: 'Trois saisons en R2.', level: 'R2' } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.user.id, player.id);
  assert.equal(data.user.photo_url, 'https://example.invalid/photo.jpg');
  assert.equal(data.user.biography, 'Ma présentation');
  assert.deepEqual(data.profile.positions, ['GOALKEEPER', 'STRIKER']);
  assert.equal(data.profile.preferred_foot, 'BOTH');
  assert.equal(data.profile.experience, 'Trois saisons en R2.');
  assert.equal(data.profile.first_name, 'Alex');
  assert.deepEqual(await read(), { user: data.user, profile: data.profile });
  assert.deepEqual(await read(other), beforeOther);
  assert.ok(!JSON.stringify(data).includes('password_hash'));
});

test('PATCH partiel : champs absents conserves et valeurs facultatives effacables', async () => {
  const response = await patch({ profile: { positions: [], current_club: '', preferred_foot: null } });
  assert.equal(response.status, 200);
  const { profile } = await response.json();
  assert.deepEqual(profile.positions, []);
  assert.equal(profile.current_club, null);
  assert.equal(profile.preferred_foot, null);
  assert.equal(profile.level, 'R2');
});

test('identite et role proteges : refus sans session, autre origine, id ou champs etrangers', async () => {
  assert.equal((await patch({ profile: { level: 'N1' } }, null)).status, 401);
  assert.equal((await patch({ profile: { level: 'N1' } }, player, 'https://autre.test')).status, 403);
  for (const body of [{ id: other.id, profile: { level: 'N1' } }, { profile: { user_id: other.id } },
    { profile: { first_name: 'Interdit' } }, { profile: { role: 'ADMIN' } }]) {
    assert.equal((await patch(body)).status, 400);
  }
  assert.equal((await patch({ profile: { level: 'N1' } }, club)).status, 403);
});

test('types, limites et postes valides controles sans aucune ecriture', async () => {
  const before = await read();
  for (const profile of [null, [], {}, { positions: 'STRIKER' }, { positions: ['TOTO'] },
    { positions: ['STRIKER', 'STRIKER'] }, { preferred_foot: 'Droit' }, { current_club: 12 },
    { level: 'x'.repeat(101) }, { past_clubs: 'x'.repeat(2001) }, { experience: '\u0000' }]) {
    assert.equal((await patch({ biography: 'Ne pas enregistrer', profile })).status, 400);
  }
  assert.deepEqual(await read(), before);
});

test('photo : HTTP, javascript, data, URL ambigue et trop longue refuses', async () => {
  for (const photo_url of ['http://example.com/a.jpg', 'javascript:alert(1)', 'data:image/svg+xml,test', '//example.com/a',
    '/\\example.com/a', 'https://name:secret@example.com/a.jpg', 'x'.repeat(2001)]) {
    const response = await patch({ photo_url });
    assert.equal(response.status, 400, photo_url.slice(0, 60));
    assert.equal((await response.json()).field, 'photo_url');
  }
  assert.equal((await patch({ photo_url: '/assets/default-avatar.svg' })).status, 200);
  assert.equal((await patch({ photo_url: '' })).status, 200);
});

test('conflit de pseudo : annulation de toutes les modifications de la demande', async () => {
  const before = await read();
  const response = await patch({ username: other.username, biography: 'Annuler', profile: { level: 'N1' } });
  assert.equal(response.status, 409);
  assert.deepEqual(await read(), before);
});

test('bannissement : les modifications personnelles deviennent interdites', async () => {
  await pool.query("UPDATE users SET status='BANNED' WHERE id=$1", [player.id]);
  try { assert.equal((await patch({ profile: { level: 'N1' } })).status, 401); }
  finally { await pool.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [player.id]); }
});

test('erreur SQL apres modification du compte : rollback du compte et de la fiche', async () => {
  const before = await read();
  const wrapped = { query: (...args) => pool.query(...args), connect: async () => {
    const client = await pool.connect();
    return { release: client.release, query: (sql, values) => {
      if (sql.startsWith('UPDATE public.player_profiles')) throw new Error('SQL prive');
      return client.query(sql, values);
    } };
  } };
  const app = configureApp(express(), wrapped, { authSecret: secret, appOrigin: origin });
  const otherServer = app.listen(0, '127.0.0.1'); await once(otherServer, 'listening');
  try {
    const response = await patch({ biography: 'Ne pas sauvegarder', profile: { level: 'N1' } }, player, origin,
      `http://127.0.0.1:${otherServer.address().port}`);
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('SQL prive'));
  } finally { await new Promise(resolve => otherServer.close(resolve)); }
  assert.deepEqual(await read(), before);
});
