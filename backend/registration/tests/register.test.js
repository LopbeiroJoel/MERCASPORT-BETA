const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { createTestPool } = require('./pool');
const { configureApp } = require('../../app');
const { verifyPassword } = require('../password');
const { validateRegistration } = require('../validation');

const pool = createTestPool();
let server, base;
const password = 'Une longue phrase pour mon compte !';
const player = { email: 'registration.player@example.invalid', username: 'Joel Test', password,
  role: 'PLAYER', profile: { first_name: 'Joel', last_name: 'Test' } };
const club = { email: 'registration.club@example.invalid', username: 'FC Test', password,
  role: 'CLUB', profile: { name: 'FC Test', city: 'Strasbourg', divisions: 'R3 / D4' } };

before(async () => {
  const app = configureApp(express(), pool);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => pool.query('DELETE FROM public.registration_rate_limits'));
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
});
const post = body => fetch(`${base}/auth/register`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const count = async () => Number((await pool.query('SELECT count(*) AS n FROM users')).rows[0].n);

test('PLAYER : compte, profil et joueur compatibles, hash salé et aucune fuite de secret', async () => {
  const response = await post({ ...player, email: ' REGISTRATION.PLAYER@example.invalid ' });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(result.user.email, player.email);
  assert.equal(result.user.role, 'PLAYER');
  assert.equal(result.user.is_verified, false);
  assert.equal(result.profile.user_id, result.user.id);
  assert.equal(result.profile.first_name, 'Joel');
  assert.ok(!JSON.stringify(result).includes('$argon2id$'));
  assert.ok(!JSON.stringify(result).includes(password));
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [result.user.id]);
  assert.match(rows[0].password_hash, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(await verifyPassword(password, rows[0].password_hash), true);
  assert.equal(await verifyPassword(`${password} faux`, rows[0].password_hash), false);
  const legacy = await pool.query('SELECT * FROM players WHERE user_id=$1', [result.user.id]);
  assert.equal(legacy.rows[0].first_name, 'Joel');
});

test('CLUB : compte, profil et club compatibles ; même mot de passe, sel différent', async () => {
  const response = await post(club);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.user.role, 'CLUB');
  const { rows } = await pool.query('SELECT name,city FROM clubs WHERE user_id=$1', [result.user.id]);
  assert.deepEqual(rows[0], { name: 'FC Test', city: 'Strasbourg' });
  const hashes = await pool.query('SELECT password_hash FROM users WHERE email=ANY($1)', [[player.email, club.email]]);
  assert.equal(hashes.rows.length, 2);
  assert.notEqual(hashes.rows[0].password_hash, hashes.rows[1].password_hash);
});

test('contrôles des champs : aucun ADMIN, mot de passe court, profil incompatible ou champ injecté', async () => {
  const initial = await count();
  for (const body of [[], null, {}, { ...player, role: 'ADMIN' }, { ...player, role: 'player' },
    { ...player, email: 'sans-arobase' }, { ...player, username: 'ab' },
    { ...player, password: 'court' }, { ...player, is_verified: true },
    { ...player, profile: { first_name: 'Joel' } },
    { ...player, profile: { ...player.profile, height_cm: '180' } },
    { ...player, profile: { ...player.profile, position: 'p'.repeat(51) } },
    { ...player, profile: { ...player.profile, preferred_foot: 'Droit' } },
    { ...player, profile: { ...player.profile, birth_date: '2025-02-30' } },
    { ...player, profile: { ...player.profile, birth_date: '0000-01-01' } },
    { ...club, profile: { name: 'Club', city: '' } }]) {
    const response = await post(body);
    assert.equal(response.status, 400);
    assert.ok(['VALIDATION_ERROR', 'INVALID_JSON'].includes((await response.json()).code));
  }
  assert.equal(await count(), initial);
  assert.equal((await post({ ...player, password: 'x'.repeat(129) })).status, 400);
});

test('doublons d’e-mail et de pseudo ignorent la casse et ne créent pas un deuxième compte', async () => {
  const initial = await count();
  for (const body of [{ ...player, username: 'Autre joueur', email: ` ${player.email.toUpperCase()} ` },
    { ...player, email: 'autre@example.invalid', username: ' joel test ' }]) {
    const response = await post(body);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'ACCOUNT_CONFLICT');
  }
  assert.equal(await count(), initial);
});

test('deux inscriptions concurrentes identiques : un 201, un 409, un seul compte et profil', async () => {
  const body = { ...player, email: 'race@example.invalid', username: 'Concurrent' };
  const responses = await Promise.all([post(body), post(body)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  const counts = await pool.query(`SELECT count(*) AS n FROM users u
    JOIN player_profiles p ON p.user_id=u.id WHERE u.email=$1`, [body.email]);
  assert.equal(Number(counts.rows[0].n), 1);
});

test('échec du profil : rollback du compte, connexion rendue au pool, pas de détail SQL dans la réponse', async () => {
  const failingPool = {
    query: (...args) => pool.query(...args),
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (sql, values) => {
          if (sql.includes('INSERT INTO public.player_profiles')) {
            const error = new Error('simulated SQL with private data'); error.code = 'XX000'; throw error;
          }
          return client.query(sql, values);
        },
        release: () => client.release(),
      };
    },
  };
  const app = configureApp(express(), failingPool);
  const failedServer = app.listen(0, '127.0.0.1'); await once(failedServer, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${failedServer.address().port}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...player, email: 'rollback@example.invalid', username: 'Rollback' }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { code: 'REGISTER_FAILED', error: 'Inscription temporairement indisponible.' });
    assert.equal(Number((await pool.query("SELECT count(*) AS n FROM users WHERE email='rollback@example.invalid'")).rows[0].n), 0);
  } finally { await new Promise(resolve => failedServer.close(resolve)); }
});

test('erreurs JSON, taille et type de contenu sont propres à l’inscription', async () => {
  assert.equal((await fetch(`${base}/auth/register`, { method: 'POST', body: 'texte' })).status, 415);
  assert.equal((await fetch(`${base}/auth/register`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await post({ ...player, extra: 'x'.repeat(10000) })).status, 413);
});

test('panne PostgreSQL : 503, aucune donnée sensible renvoyée', async () => {
  const unavailable = { query: async () => { const error = new Error('private connection'); error.code = 'ECONNREFUSED'; throw error; } };
  const app = configureApp(express(), unavailable);
  const failedServer = app.listen(0, '127.0.0.1'); await once(failedServer, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${failedServer.address().port}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...player, email: 'offline@example.invalid', username: 'Offline' }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'SERVICE_UNAVAILABLE');
  } finally { await new Promise(resolve => failedServer.close(resolve)); }
});

test('anti-abus : compteurs partages, limite de 10 tentatives et en-tetes locaux non fiables ignores', async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await post(player)).status, 409);
  }
  const response = await fetch(`${base}/auth/register`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.1',
      'x-vercel-forwarded-for': '203.0.113.2' }, body: JSON.stringify(player) });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '900');
  assert.equal((await response.json()).code, 'REGISTER_RATE_LIMIT');
  const counters = await pool.query('SELECT key_hash,attempts FROM registration_rate_limits');
  assert.equal(counters.rows.length, 1);
  assert.match(counters.rows[0].key_hash, /^[a-f0-9]{64}$/);
  assert.equal(counters.rows[0].attempts, 10);
});

test('integration : annonces, details et candidature fonctionnent avec l’inscription montee', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  const response = await fetch(`${base}/ads`);
  assert.equal(response.status, 200);
  const ads = await response.json();
  assert.equal(ads.length, 28);
  const detail = await fetch(`${base}/ads/${ads[0].id}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).id, ads[0].id);
  const application = await fetch(`${base}/applications`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      ad_id: ads[0].id, name: 'Test inscription', email: 'integration@example.invalid' }) });
  assert.equal(application.status, 201);
  const created = await application.json();
  const row = await pool.query('SELECT email FROM applications WHERE id=$1', [created.id]);
  assert.equal(row.rows[0].email, 'integration@example.invalid');
  assert.equal((await fetch(base)).status, 200);
});

test('validation : phrase longue, accents, pieds et dates réelles acceptés ; mot de passe non modifié', () => {
  const body = { ...player, username: ' FC Hégenheim ', password: ` ${password} `,
    profile: { ...player.profile, birth_date: '2000-02-29', preferred_foot: 'BOTH', height_cm: 180 } };
  const result = validateRegistration(body);
  assert.deepEqual(result.errors, {});
  assert.equal(result.data.password, body.password);
  assert.equal(result.data.username, 'FC Hégenheim');
});

test('SEC-01 : le format scrypt historique reste vérifiable sans créer de nouveaux hashes scrypt', async () => {
  const { scrypt, randomBytes } = require('node:crypto');
  const { promisify } = require('node:util');
  const salt = randomBytes(16);
  const key = await promisify(scrypt)(password, salt, 64,
    { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const legacy = `scrypt$v1$131072$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
  assert.equal(await verifyPassword(password, legacy), true);
  assert.equal(await verifyPassword('Mauvais mot de passe', legacy), false);
});

test('SEC-01 : hashes malformés ou paramètres arbitraires refusés avant tout calcul', async () => {
  for (const hash of ['', 'mot-de-passe-en-clair', '$argon2id$v=19$m=999999999,t=99,p=99$bad$bad',
    '$2b$12$ancien-format-non-pris-en-charge-ici', null]) {
    assert.equal(await verifyPassword(password, hash), false);
  }
});

test('API-03 : une vraie erreur de contrainte SQL du profil annule aussi le compte', async () => {
  await pool.query(`CREATE FUNCTION registration_test_refuse_profile() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.first_name='RollbackSQL' THEN
      RAISE EXCEPTION 'Test rollback' USING ERRCODE='23514';
    END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER registration_test_refuse BEFORE INSERT ON player_profiles
    FOR EACH ROW EXECUTE FUNCTION registration_test_refuse_profile()`);
  try {
    const response = await post({ ...player, email: 'rollback-sql@example.invalid', username: 'Rollback SQL',
      profile: { first_name: 'RollbackSQL', last_name: 'Test' } });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'REGISTER_FAILED');
    const result = await pool.query(`SELECT count(*) AS n FROM users WHERE email=$1`, ['rollback-sql@example.invalid']);
    assert.equal(Number(result.rows[0].n), 0);
  } finally {
    await pool.query('DROP TRIGGER registration_test_refuse ON player_profiles');
    await pool.query('DROP FUNCTION registration_test_refuse_profile()');
  }
});

test('postes multiples : sauvegarde et reponse de la liste complete', async () => {
  const positions = ['GOALKEEPER','CENTRE_BACK','RIGHT_BACK','LEFT_BACK',
    'RIGHT_WING_BACK','LEFT_WING_BACK','DEFENSIVE_MIDFIELDER','CENTRAL_MIDFIELDER',
    'ATTACKING_MIDFIELDER','RIGHT_MIDFIELDER','LEFT_MIDFIELDER','RIGHT_WINGER',
    'LEFT_WINGER','SECOND_STRIKER','CENTRE_FORWARD'];
  for (const [index, selection] of [positions, ['GOALKEEPER'], null, [], undefined].entries()) {
    const profile = { ...player.profile };
    if (selection !== undefined) profile.positions = selection;
    const response = await post({ ...player, email: 'positions' + index + '@example.invalid',
      username: 'Postes test ' + index, profile });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.deepEqual(data.profile.positions, selection || []);
    const stored = await pool.query('SELECT positions FROM player_profiles WHERE user_id=$1', [data.user.id]);
    assert.deepEqual(stored.rows[0].positions, selection || []);
  }
});

test('positions invalides : erreur profile.positions, aucune creation de compte', async () => {
  const initial = await count();
  for (const positions of ['GOALKEEPER', ['TOTO'], ['goalkeeper'], ['STRIKER'],
    ['GOALKEEPER','GOALKEEPER'], Array(16).fill('GOALKEEPER'), [null], [123], [['GOALKEEPER']], {}]) {
    const response = await post({ ...player, profile: { ...player.profile, positions } });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).fields['profile.positions']);
  }
  assert.equal(await count(), initial);
});

test('migration : conversion francaise, idempotence, refus sans perte puis suppression de position', async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const migration = await fs.readFile(path.join(__dirname, '../../../database/player-positions.sql'), 'utf8');
  const cleanup = await fs.readFile(path.join(__dirname, '../../../database/player-positions-cleanup.sql'), 'utf8');
  const user = (await pool.query('SELECT id FROM users WHERE email=$1', [player.email])).rows[0];
  await pool.query('ALTER TABLE player_profiles ADD COLUMN position VARCHAR(50)');
  await pool.query('UPDATE player_profiles SET position=$1 WHERE user_id=$2', ['Défenseur central', user.id]);
  await pool.exec(migration);
  await pool.exec(migration);
  assert.deepEqual((await pool.query('SELECT positions FROM player_profiles WHERE user_id=$1', [user.id])).rows[0].positions, ['CENTRE_BACK']);
  await pool.query('UPDATE player_profiles SET position=$1 WHERE user_id=$2', ['Poste inconnu', user.id]);
  await assert.rejects(pool.exec(migration), /Ancien poste non reconnu/);
  await pool.exec('ROLLBACK');
  assert.equal((await pool.query('SELECT position FROM player_profiles WHERE user_id=$1', [user.id])).rows[0].position, 'Poste inconnu');
  await pool.query('UPDATE player_profiles SET position=$1 WHERE user_id=$2', ['Gardien', user.id]);
  await pool.exec(migration);
  await pool.exec(cleanup);
  await pool.exec(cleanup);
  await pool.exec(migration);
  assert.deepEqual((await pool.query('SELECT positions FROM player_profiles WHERE user_id=$1', [user.id])).rows[0].positions, ['CENTRE_BACK','GOALKEEPER']);
  await assert.rejects(pool.query('UPDATE player_profiles SET positions=$1 WHERE user_id=$2', [['TOTO'], user.id]));
  await assert.rejects(pool.query('UPDATE player_profiles SET positions=$1 WHERE user_id=$2', [['GOALKEEPER','GOALKEEPER'], user.id]));
});
