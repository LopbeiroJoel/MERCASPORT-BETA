// REPERE ORAL - TESTS DES ACTIONS ADMIN SUR LES RESSOURCES.
// Je verifie succes, references SQL, permissions et suppression definitive.
// Les scenarios de panne controlent qu'un ROLLBACK remet aussi les dependances deja retirees.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { configureApp } = require('../backend/app');
const { createTestPool } = require('../backend/registration/tests/pool');
const { createSessionService } = require('../backend/authentication/session');
const { verifyPassword } = require('../backend/registration/password');

let pool, server, base, sessions, adminCookie, memberCookie, player, clubUser, club, ad;
const origin = 'http://localhost:3000';
const secret = 'bc'.repeat(32);
const password = 'Une phrase de test admin 2026 !';
const adBody = { city: 'Colmar', department: 'Haut-Rhin', positions: ['GOALKEEPER', 'STRIKER'],
  division_code: 'R3', description: 'Une annonce\navec plusieurs lignes.' };

async function cookieFor(userId) {
  const user = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
  let cookie;
  await sessions.issue(user, { cookie: (key, value) => { cookie = key + '=' + value; } });
  return cookie;
}
function request(route, method = 'GET', data, cookie = adminCookie, requestOrigin = origin) {
  return fetch(base + route, { method,
    headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
async function json(route, method, data, expected = 200) {
  const response = await request(route, method, data);
  const result = await response.json();
  assert.equal(response.status, expected, `${route}: ${JSON.stringify(result)}`);
  return result;
}

before(async () => {
  // Base jetable exclusivement. Ne lit jamais .env ou DATABASE_URL.
  pool = createTestPool({ migrations: ['profile.sql', 'profile-fields.sql'] });
  await pool.query("UPDATE users SET status = 'ACTIVE' WHERE id IN (1, 2)");
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

test('toutes les nouvelles ressources et méthodes sont réservées aux admins', async () => {
  const paths = ['/users', '/clubs', '/teams', '/ads', '/applications', '/positions', '/divisions'];
  for (const path of paths) {
    const identifier = path === '/positions' ? 'STRIKER' : path === '/divisions' ? 'R3' : '1';
    for (const [route, method] of [[path, 'GET'], [path, 'POST'], [path + '/' + identifier, 'GET'],
      [path + '/' + identifier, 'PATCH'], [path + '/' + identifier, 'DELETE']]) {
      const data = ['POST', 'PATCH'].includes(method) ? {} : undefined;
      assert.equal((await request('/admin' + route, method, data, null)).status, 401);
      assert.equal((await request('/admin' + route, method, data, memberCookie)).status, 403);
    }
  }
  for (const [route, method] of [['/users/2/profile', 'GET'], ['/users/2/profile', 'POST'],
    ['/users/2/profile', 'PATCH'], ['/users/2/profile', 'DELETE'], ['/users/2/status', 'PATCH'],
    ['/users/2/verification', 'PATCH'], ['/users/2/password', 'PUT']]) {
    assert.equal((await request('/admin' + route, method, ['POST', 'PATCH', 'PUT'].includes(method) ? {} : undefined, memberCookie)).status, 403);
  }
  assert.ok([401, 403].includes((await request('/admin/teams', 'POST', {}, adminCookie, 'https://autre.invalid')).status));
});

test('création joueur et club : profils cohérents, mot de passe haché, PENDING et doublons', async () => {
  const playerInput = { email: 'admin-player@example.com', username: 'AdminPlayer', password,
    role: 'PLAYER', profile: { first_name: 'Léo', last_name: 'Test', positions: ['STRIKER'] } };
  const created = await json('/admin/users', 'POST', playerInput, 201);
  player = created.user;
  assert.equal(player.status, 'PENDING');
  assert.ok(!('password_hash' in player));
  assert.deepEqual(created.profile.positions, ['STRIKER']);
  const stored = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [player.id])).rows[0];
  assert.notEqual(stored.password_hash, password);
  assert.equal(await verifyPassword(password, stored.password_hash), true);
  assert.equal((await request('/admin/users', 'POST', playerInput)).status, 409);
  assert.equal((await request('/admin/users', 'POST', { ...playerInput, role: 'ADMIN' })).status, 400);
  const result = await json('/admin/users', 'POST', { email: 'admin-club@example.com', username: 'AdminClub', password,
    role: 'CLUB', profile: { name: 'Club créé admin', city: 'Colmar' } }, 201);
  clubUser = result.user;
  club = (await pool.query('SELECT * FROM clubs WHERE user_id = $1', [clubUser.id])).rows[0];
  assert.equal(result.profile.name, club.name);
  assert.equal((await pool.query('SELECT id FROM players WHERE user_id = $1', [player.id])).rows.length, 1);
});

test('profils : lecture, modification des données communes et synchronisation des tables historiques', async () => {
  const result = await json('/admin/users/' + player.id + '/profile');
  assert.equal(result.profile.first_name, 'Léo');
  const updated = await json('/admin/users/' + player.id + '/profile', 'PATCH', {
    first_name: 'Lionel', positions: ['CENTRE_BACK', 'STRIKER'], biography: 'Profil administré',
    email_visible: true, experience: 'Une saison', height_cm: 180
  });
  assert.equal(updated.user.biography, 'Profil administré');
  assert.equal(updated.user.email_visible, true);
  assert.equal(updated.profile.experience, 'Une saison');
  assert.equal((await pool.query('SELECT first_name FROM players WHERE user_id = $1', [player.id])).rows[0].first_name, 'Lionel');
  await json('/admin/users/' + clubUser.id + '/profile', 'PATCH', { name: 'Club renommé', description: 'Première ligne\nDeuxième ligne' });
  assert.equal((await pool.query('SELECT name FROM clubs WHERE id = $1', [club.id])).rows[0].name, 'Club renommé');
  assert.equal((await request('/admin/users/' + player.id + '/profile', 'POST', { first_name: 'Test', last_name: 'Test' })).status, 409);
  for (const data of [{ email_visible: 'oui' }, { positions: ['TOTO'] }, { birth_date: '2026-02-30' },
    { height_cm: 300 }, { photo_url: 'javascript:alert(1)' }, { role: 'ADMIN' }]) {
    assert.equal((await request('/admin/users/' + player.id + '/profile', 'PATCH', data)).status, 400);
  }
});

test('onglets : filtre serveur joueur/club avant la limite de résultats', async () => {
  const players = await json('/admin/users?role=PLAYER');
  const clubs = await json('/admin/users?role=CLUB');
  assert.ok(players.users.length > 0 && clubs.users.length > 0);
  assert.ok(players.users.every(user => user.role.toUpperCase() === 'PLAYER'));
  assert.ok(clubs.users.every(user => user.role.toUpperCase() === 'CLUB'));
  const searched = await json('/admin/users?role=PLAYER&search=' + player.id);
  assert.ok(searched.users.some(user => user.id === player.id));
  for (const query of ['role=ADMIN', 'role=PLAYER&role=CLUB', 'role=club', 'role=1%20OR%201=1']) {
    assert.equal((await request('/admin/users?' + query)).status, 400);
  }
});

test('vérification e-mail : route admin explicite, booléen obligatoire et aucun secret', async () => {
  const result = await json('/admin/users/' + player.id + '/verification', 'PATCH', { is_verified: true });
  assert.equal(result.user.is_verified, true);
  assert.ok(!('password_hash' in result.user));
  assert.equal((await pool.query('SELECT is_verified FROM users WHERE id = $1', [player.id])).rows[0].is_verified, true);
  await json('/admin/users/' + player.id + '/verification', 'PATCH', { is_verified: false });
  for (const data of [{ is_verified: 'true' }, { is_verified: null }, { is_verified: 1 }, {}, { is_verified: true, role: 'ADMIN' }]) {
    assert.equal((await request('/admin/users/' + player.id + '/verification', 'PATCH', data)).status, 400);
  }
  assert.equal((await request('/admin/users/2147483647/verification', 'PATCH', { is_verified: true })).status, 404);
});

test('clubs et équipes : CRUD, pagination, cohérence des profils et refus des cascades', async () => {
  const created = (await json('/admin/clubs', 'POST', { name: 'Club indépendant', city: 'Mulhouse' }, 201)).club;
  assert.equal((await json('/admin/clubs/' + created.id)).club.id, created.id);
  await json('/admin/clubs/' + created.id, 'PATCH', { city: 'Strasbourg' });
  const team = (await json('/admin/teams', 'POST', { club_id: created.id, name: 'Équipe 1', division: 'D8' }, 201)).team;
  assert.equal((await json('/admin/teams/' + team.id)).team.name, 'Équipe 1');
  await json('/admin/teams/' + team.id, 'PATCH', { name: 'Équipe 2', category: 'Senior', division: 'D7' });
  assert.equal((await request('/admin/clubs/' + created.id, 'DELETE')).status, 409);
  assert.equal((await request('/admin/teams/' + team.id, 'DELETE')).status, 204);
  assert.equal((await request('/admin/teams/' + team.id)).status, 404);
  assert.equal((await request('/admin/clubs/' + created.id, 'DELETE')).status, 204);
  assert.equal((await request('/admin/clubs/' + created.id)).status, 404);
  assert.equal((await request('/admin/teams/1', 'DELETE')).status, 409);
  await json('/admin/clubs/' + club.id, 'PATCH', { city: 'Strasbourg' });
  assert.equal((await pool.query('SELECT city FROM club_profiles WHERE user_id = $1', [clubUser.id])).rows[0].city, 'Strasbourg');
  assert.equal((await json('/admin/clubs?limit=1&offset=0')).clubs.length, 1);
  for (const query of ['limit=0', 'offset=-1', 'limit=1&limit=2', 'limit=101']) {
    assert.equal((await request('/admin/clubs?' + query)).status, 400);
  }
  assert.equal((await request('/admin/clubs', 'POST', { name: 'Erreur', city: 'Paris', user_id: player.id })).status, 400);
});

test('annonces : création pour un propriétaire, modification d’autres clubs et suppression REST', async () => {
  ad = (await json('/admin/ads', 'POST', { ...adBody, author_id: clubUser.id }, 201)).ad;
  assert.equal(ad.author_id, clubUser.id);
  assert.equal(ad.team_id, null);
  assert.deepEqual(ad.positions, ['GOALKEEPER', 'STRIKER']);
  assert.equal((await json('/admin/ads/' + ad.id)).ad.status, 'PUBLISHED');
  await json('/admin/ads/' + ad.id, 'PATCH', { title: 'Titre corrigé' });
  const result = (await json('/admin/ads/' + ad.id, 'PATCH', { positions: ['CENTRE_BACK'], trial_possible: false })).ad;
  assert.deepEqual(result.positions, ['CENTRE_BACK']);
  assert.equal(result.trial_possible, false);
  assert.equal(result.title, 'Titre corrigé');
  await json('/admin/ads/1', 'PATCH', { additional_info: 'Modification par admin' });
  assert.equal((await request('/admin/ads/' + ad.id, 'PATCH', { author_id: 1 })).status, 400);
  assert.equal((await request('/admin/ads', 'POST', { ...adBody, author_id: 2147483647 })).status, 400);
  const playerAd = (await json('/admin/ads', 'POST', { ...adBody, author_id: player.id }, 201)).ad;
  assert.equal(playerAd.club_id, null);
  assert.equal((await request('/admin/ads/' + playerAd.id, 'DELETE')).status, 204);
  assert.equal((await request('/ads/' + playerAd.id)).status, 404);
  assert.equal((await request('/admin/ads/' + playerAd.id)).status, 404);
  assert.equal((await pool.query('SELECT id FROM ads WHERE id=$1', [playerAd.id])).rows.length, 0);
});

test('candidatures : CRUD et refus de suppression d’un profil encore utilisé', async () => {
  const playerId = (await pool.query('SELECT id FROM players WHERE user_id = $1', [player.id])).rows[0].id;
  const application = (await json('/admin/applications', 'POST', { ad_id: ad.id, player_id: playerId,
    name: 'Lionel Test', email: '  Lionel@Example.com ', message: 'Bonjour\nMerci' }, 201)).application;
  assert.equal(application.email, 'lionel@example.com');
  assert.equal((await json('/admin/applications/' + application.id)).application.id, application.id);
  await json('/admin/applications/' + application.id, 'PATCH', { message: 'Message corrigé', phone: '+33600000000' });
  assert.equal((await request('/admin/users/' + player.id + '/profile', 'DELETE')).status, 409);
  assert.equal((await request('/admin/applications', 'POST', { ad_id: 2147483647, name: 'Test', email: 'test@example.com' })).status, 400);
  assert.equal((await request('/admin/applications/' + application.id, 'DELETE')).status, 204);
  assert.equal((await request('/admin/applications/' + application.id)).status, 404);
  assert.equal((await request('/admin/users/' + player.id + '/profile', 'DELETE')).status, 204);
  await json('/admin/users/' + player.id + '/profile', 'POST', { first_name: 'Léo', last_name: 'Test', positions: ['STRIKER'] }, 201);
});

test('catalogues : lecture, modification, suppression protégée et recréation des codes connus', async () => {
  assert.equal((await json('/admin/positions')).positions.length, 14);
  assert.equal((await json('/admin/divisions')).divisions.length, 14);
  await json('/admin/positions/RIGHT_WING_BACK', 'PATCH', { label: 'Piston droit test' });
  assert.equal((await request('/admin/positions/GOALKEEPER', 'DELETE')).status, 409);
  assert.equal((await request('/admin/divisions/R3', 'DELETE')).status, 409);
  assert.equal((await request('/admin/positions/RIGHT_WING_BACK', 'DELETE')).status, 204);
  assert.equal((await request('/admin/users/' + player.id + '/profile', 'PATCH', { positions: ['RIGHT_WING_BACK'] })).status, 400);
  assert.equal((await request('/auth/register', 'POST', { username: 'Catalogue manquant', email: 'catalogue@example.com', password,
    role: 'PLAYER', profile: { first_name: 'Test', last_name: 'Test', positions: ['RIGHT_WING_BACK'] } })).status, 400);
  await json('/admin/positions', 'POST', { code: 'RIGHT_WING_BACK', label: 'Piston droit', sort_order: 5 }, 201);
  assert.equal((await request('/admin/divisions/D8', 'DELETE')).status, 204);
  await json('/admin/divisions', 'POST', { code: 'D8', sort_order: 1 }, 201);
  await json('/admin/divisions/D8', 'PATCH', { sort_order: 20 });
  await json('/admin/divisions/D8', 'PATCH', { sort_order: 1 });
  assert.equal((await request('/admin/positions', 'POST', { code: 'TOTO', label: 'Inconnu', sort_order: 20 })).status, 400);
  assert.equal((await request('/admin/divisions/D8', 'PATCH', { sort_order: 0 })).status, 400);
  assert.equal((await request('/admin/positions/STRIKER', 'PATCH', { sort_order: 1 })).status, 409);
});

test('statuts, mot de passe et suppression définitive des comptes', async () => {
  await json('/admin/users/' + player.id + '/status', 'PATCH', { status: 'ACTIVE' });
  const oldCookie = await cookieFor(player.id);
  assert.equal((await request('/profile/me', 'GET', undefined, oldCookie)).status, 200);
  assert.equal((await request('/admin/users/' + player.id + '/password', 'PUT', { password: 'court' })).status, 400);
  assert.equal((await request('/admin/users/' + player.id + '/password', 'PUT', { password: password + ' neuf' })).status, 204);
  assert.equal((await request('/profile/me', 'GET', undefined, oldCookie)).status, 401);
  const stored = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [player.id])).rows[0];
  assert.equal(await verifyPassword(password + ' neuf', stored.password_hash), true);
  assert.equal((await request('/admin/users/1', 'DELETE')).status, 403);
  assert.equal((await request('/admin/users/1/status', 'PATCH', { status: 'DISABLED' })).status, 403);
  assert.equal((await request('/admin/users/' + clubUser.id + '/status', 'PATCH', { status: 'TOTO' })).status, 400);
  assert.equal((await request('/admin/users/' + clubUser.id, 'DELETE')).status, 204);
  assert.equal((await request('/admin/users/' + clubUser.id)).status, 404);
  for (const table of ['users', 'club_profiles', 'clubs', 'auth_sessions']) {
    const key = table === 'users' ? 'id' : 'user_id';
    assert.equal((await pool.query(`SELECT * FROM ${table} WHERE ${key}=$1`, [clubUser.id])).rows.length, 0);
  }
  assert.equal((await pool.query('SELECT id FROM ads WHERE id=$1', [ad.id])).rows.length, 0);
  assert.equal((await request('/ads/' + ad.id)).status, 404);
});

test('échec SQL : création compte/profil et annonce/postes entièrement annulées', async () => {
  const count = async table => Number((await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  const users = await count('users');
  await pool.exec(`CREATE FUNCTION refuse_profile() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'SQL privé'; END $$;
    CREATE TRIGGER refuse_profile BEFORE INSERT ON player_profiles FOR EACH ROW EXECUTE FUNCTION refuse_profile();`);
  try {
    const response = await request('/admin/users', 'POST', { username: 'Annulé', email: 'annule@example.com', password,
      role: 'PLAYER', profile: { first_name: 'Test', last_name: 'Test' } });
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /SQL privé|password_hash/);
    assert.equal(await count('users'), users);
  } finally {
    await pool.exec('DROP TRIGGER refuse_profile ON player_profiles; DROP FUNCTION refuse_profile();');
  }
  const ads = await count('ads');
  await pool.exec(`CREATE FUNCTION refuse_positions() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'SQL privé'; END $$;
    CREATE TRIGGER refuse_positions BEFORE INSERT ON ad_positions FOR EACH ROW EXECUTE FUNCTION refuse_positions();`);
  try {
    assert.equal((await request('/admin/ads', 'POST', { ...adBody, author_id: player.id })).status, 400);
    assert.equal(await count('ads'), ads);
  } finally {
    await pool.exec('DROP TRIGGER refuse_positions ON ad_positions; DROP FUNCTION refuse_positions();');
  }
});

test('JSON, identifiants, champs inconnus et références invalides sont refusés proprement', async () => {
  for (const route of ['/clubs/abc', '/teams/0', '/applications/2147483648', '/ads/1%20OR%201=1']) {
    assert.equal((await request('/admin' + route)).status, 400);
  }
  for (const route of ['/clubs/2147483647', '/teams/2147483647', '/applications/2147483647', '/ads/2147483647']) {
    assert.equal((await request('/admin' + route)).status, 404);
  }
  for (const route of ['/clubs', '/teams', '/applications']) {
    assert.equal((await request('/admin' + route, 'POST', { password_hash: 'injection' })).status, 400);
  }
  const response = await fetch(base + '/admin/clubs', { method: 'POST',
    headers: { Cookie: adminCookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 400);
  const denied = await fetch(base + '/admin/clubs', { method: 'POST',
    headers: { Cookie: adminCookie, Origin: origin, 'Content-Type': 'text/plain' }, body: 'texte' });
  assert.equal(denied.status, 415);
});


test('suppression joueur : profils, sessions, annonces, candidatures et historique effacés', async () => {
  const user = (await json('/admin/users', 'POST', { email: 'delete-player@example.com', username: 'DeletePlayer', password,
    role: 'PLAYER', profile: { first_name: 'Test', last_name: 'Delete', positions: ['STRIKER'] } }, 201)).user;
  const cookie = await cookieFor(user.id);
  const playerId = (await pool.query('SELECT id FROM players WHERE user_id=$1', [user.id])).rows[0].id;
  const ownAd = (await json('/admin/ads', 'POST', { ...adBody, author_id: user.id }, 201)).ad;
  const otherAd = (await pool.query('SELECT id FROM ads WHERE author_id=3 LIMIT 1')).rows[0];
  const application = (await json('/admin/applications', 'POST', { ad_id: otherAd.id, player_id: playerId,
    name: 'Test', email: 'delete-player@example.com' }, 201)).application;
  await pool.query("INSERT INTO admin_actions(admin_user_id,action,target_user_id) VALUES (1,'BAN_USER',$1)", [user.id]);
  assert.equal((await request('/admin/users/' + user.id, 'DELETE')).status, 204);
  for (const [table, key, value] of [['users','id',user.id], ['players','user_id',user.id], ['player_profiles','user_id',user.id],
    ['auth_sessions','user_id',user.id], ['admin_actions','target_user_id',user.id], ['ads','id',ownAd.id], ['applications','id',application.id]]) {
    assert.equal((await pool.query(`SELECT * FROM ${table} WHERE ${key}=$1`, [value])).rows.length, 0);
  }
  assert.equal((await request('/profile/me', 'GET', undefined, cookie)).status, 401);
  assert.equal((await request('/admin/users/' + user.id, 'DELETE')).status, 404);
  assert.equal((await pool.query('SELECT id FROM ads WHERE id=$1', [otherAd.id])).rows.length, 1);
});

test('suppression club : équipes et anciennes annonces sans auteur effacées avec le compte', async () => {
  const user = (await json('/admin/users', 'POST', { email: 'delete-club@example.com', username: 'DeleteClub', password,
    role: 'CLUB', profile: { name: 'Club Delete', city: 'Colmar' } }, 201)).user;
  const club = (await pool.query('SELECT id FROM clubs WHERE user_id=$1', [user.id])).rows[0];
  const team = (await json('/admin/teams', 'POST', { club_id: club.id, name: 'Equipe', division: 'R3' }, 201)).team;
  let oldAd;
  await pool.exec('ALTER TABLE ads DISABLE TRIGGER USER');
  try {
  oldAd = (await pool.query("INSERT INTO ads(team_id,club_id,title,position,description) VALUES ($1,$2,'Ancienne','Gardien','Test') RETURNING id", [team.id, club.id])).rows[0];
  } finally {
    await pool.exec('ALTER TABLE ads ENABLE TRIGGER USER');
  }
  await pool.query("INSERT INTO admin_actions(admin_user_id,action,target_ad_id) VALUES (1,'DELETE_AD',$1)", [oldAd.id]);
  assert.equal((await request('/admin/users/' + user.id, 'DELETE')).status, 204);
  assert.equal((await pool.query('SELECT id FROM teams WHERE id=$1', [team.id])).rows.length, 0);
  assert.equal((await pool.query('SELECT id FROM ads WHERE id=$1', [oldAd.id])).rows.length, 0);
});

test('suppression compte : une erreur SQL annule aussi le retrait des dépendances', async () => {
  const user = (await json('/admin/users', 'POST', { email: 'rollback-delete@example.com', username: 'RollbackDelete', password,
    role: 'PLAYER', profile: { first_name: 'Test', last_name: 'Rollback' } }, 201)).user;
  const cookie = await cookieFor(user.id);
  const ownAd = (await json('/admin/ads', 'POST', { ...adBody, author_id: user.id }, 201)).ad;
  await pool.exec(`CREATE FUNCTION refuse_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Erreur SQL privée' USING ERRCODE = 'XX000'; END $$;
    CREATE TRIGGER refuse_user_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION refuse_user_delete();`);
  try {
    assert.equal((await request('/admin/users/' + user.id, 'DELETE')).status, 503);
    assert.equal((await pool.query('SELECT id FROM users WHERE id=$1', [user.id])).rows.length, 1);
    assert.equal((await pool.query('SELECT user_id FROM player_profiles WHERE user_id=$1', [user.id])).rows.length, 1);
    assert.equal((await pool.query('SELECT id FROM ads WHERE id=$1', [ownAd.id])).rows.length, 1);
    assert.equal((await pool.query('SELECT ad_id FROM ad_positions WHERE ad_id=$1', [ownAd.id])).rows.length, 2);
    assert.equal((await request('/profile/me', 'GET', undefined, cookie)).status, 200);
  } finally {
    await pool.exec('DROP TRIGGER refuse_user_delete ON users; DROP FUNCTION refuse_user_delete();');
  }
});
