const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { configureApp } = require('../backend/app');
const { createSessionService } = require('../backend/authentication/session');
const { createTestPool } = require('../backend/registration/tests/pool');
const { transaction } = require('../backend/messaging/core');
const pool = createTestPool({
  migrations: ['profile.sql', 'profile-fields.sql'],
  afterMigrations: [
    'migrations/20261019-messaging-up.sql',
    'migrations/20261019-messaging-reports.sql',
    'migrations/20261020-player-ad-fields-up.sql'
  ]
});
const secret = '3210fedcba987654'.repeat(4),
  origin = 'https://player-ad.test';
let server, base, player, club, outsider, ad;
async function account(role, name) {
  const user = (
    await pool.query(
      "INSERT INTO users(name,username,email,password_hash,role,status) VALUES($1,$1,$2,'fixture',$3,'ACTIVE') RETURNING *",
      [name, name + '@example.invalid', role]
    )
  ).rows[0];
  if (role === 'CLUB')
    user.clubId = (
      await pool.query(
        "INSERT INTO clubs(user_id,name,city) VALUES($1,$2,'Colmar') RETURNING id",
        [user.id, name]
      )
    ).rows[0].id;
  await createSessionService(pool, { secret, origins: [origin] }).issue(user, {
    cookie: (name, value) => (user.cookie = name + '=' + value)
  });
  return user;
}
async function call(path, user = player, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(user ? { Cookie: user.cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: origin } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  return {
    status: response.status,
    data: response.status === 204 ? null : await response.json()
  };
}
const valid = () => ({
  announcement_type: 'PLAYER_SEARCH',
  status: 'PUBLISHED',
  title: 'Joueur motivé recherche un club',
  description: 'Reprise du football amateur dans une équipe conviviale.',
  positions: ['STRIKER'],
  division_code: 'D8',
  city: 'Colmar',
  mobility_code: '25_KM',
  availability_code: 'NOW',
  project_types: ['LEISURE'],
  player_details: {
    current_club: 'Aucun club',
    past_clubs: 'Aucun ancien club',
    experience: 'Débutant'
  }
});
before(async () => {
  player = await account('PLAYER', 'joueur-champs');
  outsider = await account('PLAYER', 'joueur-intrus');
  club = await account('CLUB', 'club-champs');
  server = configureApp(express(), pool, {
    authSecret: secret,
    appOrigin: origin
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});
test('chaque champ obligatoire bloque la publication, sans créer une annonce', async () => {
  const count = (await pool.query('SELECT count(*)::int n FROM ads')).rows[0].n;
  for (const key of [
    'title',
    'description',
    'positions',
    'division_code',
    'city',
    'mobility_code',
    'availability_code',
    'project_types',
    'player_details.current_club',
    'player_details.past_clubs',
    'player_details.experience'
  ]) {
    const input = valid();
    if (key.startsWith('player_details.')) delete input.player_details[key.split('.')[1]];
    else delete input[key];
    const result = await call('/ads', player, 'POST', input);
    assert.equal(result.status, 400, JSON.stringify({ key, ...result }));
    assert.equal(result.data.code, 'VALIDATION_ERROR');
    assert.ok(result.data.fields[key], key);
  }
  assert.equal((await pool.query('SELECT count(*)::int n FROM ads')).rows[0].n, count);
});
test('minimum complet accepté, informations facultatives absentes et parcours débutant explicite', async () => {
  const result = await call('/ads', player, 'POST', valid());
  assert.equal(result.status, 201, JSON.stringify(result));
  ad = result.data.id;
  assert.equal(result.data.player_details.experience, 'Débutant');
  assert.equal(result.data.preferred_foot, null);
  assert.equal(result.data.qualities.length, 0);
  assert.equal(
    (await pool.query('SELECT recruitment_version FROM ads WHERE id=$1', [ad])).rows[0]
      .recruitment_version,
    3
  );
  assert.equal(
    (await call('/ads/' + ad + '?view=offers', club)).data.player_details.current_club,
    'Aucun club'
  );
  assert.equal(
    (await call('/ads/' + ad, outsider, 'PATCH', { title: 'Usurpation' })).status,
    403
  );
});
test('brouillon partiel autorisé, publication et renouvellement incomplets refusés', async () => {
  const created = await call('/ads', outsider, 'POST', {
    announcement_type: 'PLAYER_SEARCH',
    status: 'DRAFT',
    title: 'Brouillon'
  });
  assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal(
    (
      await call('/ads/' + created.data.id, outsider, 'PATCH', {
        status: 'PUBLISHED'
      })
    ).status,
    400
  );
  assert.equal(
    (await call('/ads/' + created.data.id + '/renew', outsider, 'POST', {})).status,
    400
  );
  const complete = await call('/ads/' + created.data.id, outsider, 'PATCH', valid());
  assert.equal(complete.status, 200, JSON.stringify(complete));
  assert.equal(
    (await call('/ads/' + created.data.id + '/renew', outsider, 'POST', {})).status,
    200
  );
});
test('types, bornes et clés des données facultatives contrôlés', async () => {
  for (const player_details of [
    { age: 4 },
    { age: 101 },
    { age: 20.5 },
    { height_cm: 79 },
    { height_cm: '180' },
    { sport_stats: { goals: -1 } },
    { sport_stats: { wins: 2 } },
    { sport_stats: [] },
    { sport_season: '2026' },
    { unknown: 'x' },
    []
  ]) {
    const result = await call('/ads/' + ad, player, 'PATCH', {
      player_details
    });
    assert.equal(result.status, 400, JSON.stringify({ player_details, ...result }));
  }
  assert.equal(
    (await call('/ads/' + ad, player, 'PATCH', { preferred_foot_code: 'ANY' })).status,
    400
  );
  const good = await call('/ads/' + ad, player, 'PATCH', {
    player_details: {
      age: 22,
      height_cm: 182,
      sport_stats: { appearances: 0, goals: 12, assists: 7 },
      sport_season: '2026/2027'
    },
    preferred_foot_code: 'LEFT'
  });
  assert.equal(good.status, 200, JSON.stringify(good));
  assert.equal(good.data.player_details.current_club, 'Aucun club');
  assert.equal(good.data.player_details.sport_stats.appearances, 0);
  assert.equal(good.data.preferred_foot, 'Gauche');
});
test('20 qualités possibles, 5 par catégorie ; limites postes et projets conservées', async () => {
  const qualities = (await pool.query('SELECT code FROM sport_qualities')).rows.map(
    (r) => r.code
  );
  assert.equal(qualities.length, 20);
  assert.equal((await call('/ads/' + ad, player, 'PATCH', { qualities })).status, 200);
  assert.equal(
    (
      await call('/ads/' + ad, player, 'PATCH', {
        positions: ['STRIKER', 'LEFT_BACK', 'RIGHT_BACK']
      })
    ).status,
    400
  );
  assert.equal(
    (
      await call('/ads/' + ad, player, 'PATCH', {
        project_types: ['LEISURE', 'COMPETITION', 'PROGRESSION', 'RETURN']
      })
    ).status,
    400
  );
  await pool.query(
    "INSERT INTO sport_qualities(code,label,category,sort_order) VALUES('TEST_SIXTH','Test isolé','TECHNICAL',999)"
  );
  const technical = (
    await pool.query("SELECT code FROM sport_qualities WHERE category='TECHNICAL'")
  ).rows.map((r) => r.code);
  const invalid = await call('/ads/' + ad, player, 'PATCH', {
    qualities: technical
  });
  assert.equal(invalid.status, 400, JSON.stringify(invalid));
  await assert.rejects(
    () =>
      transaction(pool, player.id, (c) =>
        c.query("INSERT INTO ad_qualities(ad_id,quality_code) VALUES($1,'TEST_SIXTH')", [ad])
      ),
    (e) => e.code === '23514'
  );
  await pool.query("DELETE FROM sport_qualities WHERE code='TEST_SIXTH'");
});
test('SQL protège les champs obligatoires et le dernier poste/projet', async () => {
  for (const sql of [
    'DELETE FROM ad_positions WHERE ad_id=$1',
    'DELETE FROM ad_project_types WHERE ad_id=$1',
    "UPDATE ads SET player_details='{}' WHERE id=$1",
    'UPDATE ads SET city=NULL WHERE id=$1',
    "UPDATE ads SET player_details=jsonb_build_object('age','vingt') WHERE id=$1"
  ]) {
    await assert.rejects(
      () => transaction(pool, player.id, (c) => c.query(sql, [ad])),
      (e) => e.code === '23514'
    );
  }
  assert.equal((await call('/ads/' + ad + '?view=offers', club)).status, 200);
});
test('pas de copie implicite du CV privé, annonce et fiche indépendantes', async () => {
  assert.equal(
    (await pool.query('SELECT 1 FROM player_profiles WHERE user_id=$1', [player.id])).rows
      .length,
    0
  );
  await pool.query(
    "INSERT INTO player_profiles(user_id,first_name,last_name,current_club,experience) VALUES($1,'Joueur','Secret','Club privé','Texte du CV')",
    [player.id]
  );
  await call('/ads/' + ad, player, 'PATCH', {
    player_details: { experience: 'Texte public' }
  });
  const cv = (
    await pool.query('SELECT experience,current_club FROM player_profiles WHERE user_id=$1', [
      player.id
    ])
  ).rows[0];
  assert.equal(cv.experience, 'Texte du CV');
  const result = (await call('/ads/' + ad + '?view=offers', club)).data;
  assert.equal(result.player_details.experience, 'Texte public');
  assert.equal(result.player_details.current_club, 'Aucun club');
  assert.ok(!JSON.stringify(result).includes('Club privé'));
});
test('annonces club inchangées, migration préserve les anciennes annonces', async () => {
  const result = await call('/ads', club, 'POST', {
    announcement_type: 'CLUB_SEARCH',
    club_id: club.clubId,
    status: 'PUBLISHED'
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  const qualities = (await pool.query('SELECT code FROM sport_qualities LIMIT 6')).rows.map(
    (r) => r.code
  );
  assert.equal(
    (await call('/ads/' + result.data.id, club, 'PATCH', { qualities })).status,
    400
  );
  assert.equal(
    (
      await call('/ads/' + result.data.id, club, 'PATCH', {
        player_details: { age: 22 }
      })
    ).status,
    400
  );
  assert.equal((await call('/ads', null)).data.length, 29);
  assert.equal(
    (await pool.query('SELECT count(*)::int n FROM ads WHERE recruitment_version=1')).rows[0].n,
    28
  );
});

test('retour arrière refusé dès qu’une annonce utilise les nouveaux champs', async () => {
  const fs = require('node:fs');
  await assert.rejects(() => pool.exec(fs.readFileSync(require('node:path').join(__dirname, '../database/migrations/20261020-player-ad-fields-down.sql'), 'utf8')), /Retour arriere refuse/);
  await pool.query('ROLLBACK');
  assert.equal((await call('/ads/' + ad + '?view=offers', club)).status, 200);
});
