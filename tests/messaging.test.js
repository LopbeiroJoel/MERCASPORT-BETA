const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { configureApp } = require('../backend/app');
const { createSessionService } = require('../backend/authentication/session');
const { createTestPool } = require('../backend/registration/tests/pool');
const pool = createTestPool({
  migrations: ['profile.sql', 'profile-fields.sql'],
  afterMigrations: [
    'migrations/20261019-messaging-up.sql',
    'migrations/20261019-messaging-reports.sql',
    'migrations/20261020-player-ad-fields-up.sql',
    'migrations/20261020-player-ad-options.sql'
  ]
});
const secret = '0123456789abcdef'.repeat(4),
  origin = 'https://mercasport.test';
const sessions = createSessionService(pool, { secret, origins: [origin] });
let base,
  server,
  player,
  club,
  third,
  otherClub,
  admin,
  member,
  conversation,
  application,
  ad,
  message;
async function account(role, name) {
  const user = (
    await pool.query(
      "INSERT INTO users(name,username,email,password_hash,role,status) VALUES($1,$1,$2,'hash-uniquement-pour-tests',$3,'ACTIVE') RETURNING *",
      [name, name + '@example.invalid', role]
    )
  ).rows[0];
  if (role === 'CLUB')
    user.clubId = (
      await pool.query('INSERT INTO clubs(user_id,name,city) VALUES($1,$2,$3) RETURNING id', [
        user.id,
        'Club ' + name,
        'Colmar'
      ])
    ).rows[0].id;
  await sessions.issue(user, {
    cookie: (name, token) => {
      user.cookie = name + '=' + token;
    }
  });
  return user;
}
async function call(path, user = player, method = 'GET', data, extra = {}) {
  const headers = {
    ...(user ? { Cookie: user.cookie } : {}),
    ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: origin } : {}),
    ...extra
  };
  const response = await fetch(base + path, {
    method,
    headers,
    ...(data !== undefined ? { body: JSON.stringify(data) } : {})
  });
  const payload = response.status === 204 ? null : await response.json();
  return { status: response.status, data: payload };
}
before(async () => {
  player = await account('PLAYER', 'joueur-message');
  third = await account('PLAYER', 'autre-joueur');
  member = await account('PLAYER', 'representant');
  club = await account('CLUB', 'club-message');
  otherClub = await account('CLUB', 'autre-club');
  admin = await account('ADMIN', 'moderateur');
  await pool.query("INSERT INTO admin_permissions(user_id,role) VALUES($1,'ADMIN')", [admin.id]);
  server = configureApp(express(), pool, { authSecret: secret, appOrigin: origin }).listen(
    0,
    '127.0.0.1'
  );
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

test('migration additive, catalogues SQL et ancien formulaire conservés', async () => {
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ads')).rows[0].n, 28);
  const result = await call('/recruitment/options', null);
  assert.equal(result.status, 200);
  assert.equal(result.data.positions.length, 14);
  assert.equal(result.data.divisions.length, 14);
  assert.equal(result.data.qualities.length, 48);
  assert.equal((await call('/ads', null)).data.length, 28);
  const old = await call('/ads', club, 'POST', {
    positions: ['STRIKER'],
    division_code: 'R2',
    department: 'Haut-Rhin',
    city: 'Colmar',
    description: 'Un club qui cherche un attaquant.'
  });
  assert.equal(old.status, 201, JSON.stringify(old));
});
test('joueur sans fiche : contact direct, deux participants et dédoublonnage concurrent', async () => {
  assert.equal(
    (await pool.query('SELECT 1 FROM player_profiles WHERE user_id=$1', [player.id])).rows.length,
    0
  );
  const result = await call('/conversations', player, 'POST', { club_id: club.clubId });
  assert.equal(result.status, 201, JSON.stringify(result));
  conversation = result.data.id;
  const duplicates = await Promise.all([
    call('/conversations', player, 'POST', { club_id: club.clubId }),
    call('/conversations', player, 'POST', { club_id: club.clubId })
  ]);
  assert.ok(duplicates.every((r) => r.status === 200 && r.data.id === conversation));
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM conversation_participants WHERE conversation_id=$1',
        [conversation]
      )
    ).rows[0].n,
    2
  );
  assert.equal((await call('/conversations/' + conversation + '/messages', third)).status, 404);
  assert.equal((await call('/conversations/' + conversation, otherClub)).status, 404);
  assert.equal((await call('/conversations', null)).status, 401);
  assert.equal(
    (
      await call('/conversations', player, 'POST', {
        club_id: club.clubId,
        player_user_id: third.id
      })
    ).status,
    403
  );
});
test('messages texte : appartenance, historique, non-lus, lecture et nonce idempotent', async () => {
  const input = {
    message_body: 'Bonjour, <img src=x onerror=alert(1)> https://example.com',
    client_nonce: randomUUID()
  };
  const first = await call('/conversations/' + conversation + '/messages', player, 'POST', input);
  assert.equal(first.status, 201, JSON.stringify(first));
  message = first.data.message.id;
  const again = await call('/conversations/' + conversation + '/messages', player, 'POST', input);
  assert.equal(again.status, 200);
  assert.equal(again.data.message.id, message);
  const wrong = await call('/conversations/' + conversation + '/messages', player, 'POST', {
    ...input,
    message_body: 'Un autre texte'
  });
  assert.equal(wrong.status, 409);
  assert.equal(
    (
      await call('/conversations/' + conversation + '/messages', third, 'POST', {
        message_body: 'Intrusion',
        client_nonce: randomUUID()
      })
    ).status,
    404
  );
  assert.equal(
    (
      await call('/conversations/' + conversation + '/messages', player, 'POST', {
        message_body: 'x'.repeat(4001),
        client_nonce: randomUUID()
      })
    ).status,
    400
  );
  assert.equal(
    (
      await call('/conversations/' + conversation + '/messages', player, 'POST', {
        message_body: 'Texte',
        client_nonce: randomUUID(),
        sender_user_id: club.id
      })
    ).status,
    400
  );
  const list = await call('/conversations', club);
  assert.equal(list.data.items.find((c) => c.id === conversation).unread_count, 1);
  const history = await call('/conversations/' + conversation + '/messages', club);
  assert.equal(history.data.items[0].message_body, input.message_body);
  assert.equal(history.data.items[0].mine, false);
  assert.equal(
    (
      await call('/conversations/' + conversation + '/read', club, 'PATCH', {
        last_message_id: message
      })
    ).status,
    204
  );
  assert.equal(
    (await call('/conversations', club)).data.items.find((c) => c.id === conversation).unread_count,
    0
  );
  assert.equal(
    (
      await call('/conversations/' + conversation + '/read', club, 'PATCH', {
        last_message_id: message
      })
    ).status,
    204
  );
  assert.equal(
    (await call('/conversations/' + conversation + '/messages', player)).data.items[0].read,
    true
  );
  const notice = await call('/notifications', club);
  assert.ok(notice.data.items.some((n) => n.message_id === message));
  assert.equal(
    (await call('/notifications/' + notice.data.items[0].id, third, 'PATCH', {})).status,
    404
  );
});
test('annonces : recherche joueur complète et détails club facultatifs, filtres SQL et droits du propriétaire', async () => {
  const p = await call('/ads', player, 'POST', {
    announcement_type: 'PLAYER_SEARCH',
    status: 'PUBLISHED',
    title: 'Recherche un club',
    description: 'Débutant motivé pour reprendre le football.',
    positions: ['STRIKER'],
    division_code: 'D8',
    city: 'Colmar',
    mobility_code: '10_KM',
    availability_code: 'NOW',
    project_types: ['LEISURE'],
    player_details: {
      current_club: 'Aucun club',
      past_clubs: 'Aucun ancien club',
      experience: 'Débutant'
    }
  });
  assert.equal(p.status, 201, JSON.stringify(p));
  assert.equal(p.data.positions.length, 1);
  const c = await call('/ads', club, 'POST', {
    announcement_type: 'CLUB_SEARCH',
    club_id: club.clubId,
    status: 'PUBLISHED'
  });
  assert.equal(c.status, 201, JSON.stringify(c));
  ad = c.data.id;
  const many = await call('/ads', club, 'POST', {
    announcement_type: 'CLUB_SEARCH',
    club_id: club.clubId,
    positions: ['STRIKER', 'LEFT_BACK', 'RIGHT_BACK', 'CENTRE_BACK']
  });
  assert.equal(many.status, 400);
  const invalid = await call('/ads', club, 'POST', {
    announcement_type: 'CLUB_SEARCH',
    club_id: otherClub.clubId
  });
  assert.equal(invalid.status, 403);
  assert.equal((await call('/ads/' + ad, third, 'PATCH', { title: 'Vol' })).status, 403);
  const changed = await call('/ads/' + ad, club, 'PATCH', {
    positions: ['STRIKER'],
    sport_code: 'FOOTBALL',
    division_code: 'R2',
    availability_code: 'NOW',
    city: 'Mulhouse'
  });
  assert.equal(changed.status, 200, JSON.stringify(changed));
  const filtered = await call(
    '/ads?view=market&type=CLUB_SEARCH&sport=FOOTBALL&position=STRIKER&level=R2&city=Mulhouse&availability=NOW',
    null
  );
  assert.ok(filtered.data.items.some((a) => a.id === ad));
  assert.equal(filtered.data.items[0].application_count, undefined);
  assert.equal((await call('/ads/' + ad, club, 'PATCH', { status: 'SUSPENDED' })).status, 200);
  assert.equal((await call('/ads/' + ad + '?view=market', null)).status, 404);
  assert.equal((await call('/ads/' + ad + '/renew', club, 'POST', {})).status, 200);
});
test('Offres remplace Mercato : flux opposé au rôle, détails et ancienne URL', async () => {
  const playerAd = (
    await pool.query(
      "SELECT id FROM ads WHERE announcement_type='PLAYER_SEARCH' AND author_id=$1 ORDER BY id DESC LIMIT 1",
      [player.id]
    )
  ).rows[0].id;
  const clubs = (await call('/ads?view=offers', player)).data.items;
  const players = (await call('/ads?view=offers', club)).data.items;
  assert.ok(clubs.some((a) => a.id === ad));
  assert.ok(clubs.every((a) => a.announcement_type === 'CLUB_SEARCH'));
  assert.ok(players.some((a) => a.id === playerAd));
  assert.ok(players.every((a) => a.announcement_type === 'PLAYER_SEARCH'));
  assert.ok(
    (await call('/ads?view=offers&type=CLUB_SEARCH', club)).data.items.every(
      (a) => a.announcement_type === 'PLAYER_SEARCH'
    )
  );
  assert.ok(
    (await call('/ads?view=market&type=PLAYER_SEARCH', player)).data.items.every(
      (a) => a.announcement_type === 'CLUB_SEARCH'
    )
  );
  assert.equal((await call('/ads/' + playerAd + '?view=offers', club)).status, 200);
  assert.equal((await call('/ads/' + ad + '?view=offers', club)).status, 404);
  assert.equal((await call('/ads/' + playerAd + '?view=offers', player)).status, 404);
  assert.ok((await call('/ads', club)).data.some((a) => a.id === playerAd));
  assert.ok(!(await call('/ads', club)).data.some((a) => a.id === ad));
  assert.equal((await call('/ads/' + playerAd, club)).status, 200);
  assert.ok((await call('/ads?view=market&owned=1', club)).data.items.some((a) => a.id === ad));
  const old = await fetch(base + '/mercato.html?ad=' + ad, { redirect: 'manual' });
  assert.equal(old.status, 302);
  assert.equal(old.headers.get('location'), '/offres.html?ad=' + ad);
  const page = await fetch(base + '/offres.html');
  assert.ok(!(await page.text()).includes('mercato.html'));
});

test('candidature sans CV, absence de doublon et essai accepté uniquement par le joueur', async () => {
  const first = await call('/ads/' + ad + '/applications', player, 'POST', {
    message: 'Je suis intéressé.',
    share_profile: false
  });
  assert.equal(first.status, 201, JSON.stringify(first));
  application = first.data.application.id;
  const again = await call('/ads/' + ad + '/applications', player, 'POST', {});
  assert.equal(again.status, 200);
  assert.equal(again.data.application.id, application);
  assert.equal((await call('/applications/' + application, third)).status, 404);
  assert.equal(
    (await call('/applications/' + application, player, 'PATCH', { status_code: 'TRIAL_PROPOSED' }))
      .status,
    403
  );
  assert.equal(
    (await call('/applications/' + application, club, 'PATCH', { status_code: 'TRIAL_PROPOSED' }))
      .status,
    200
  );
  assert.equal(
    (await call('/applications/' + application, club, 'PATCH', { status_code: 'TRIAL_ACCEPTED' }))
      .status,
    403
  );
  assert.equal(
    (await call('/applications/' + application, player, 'PATCH', { status_code: 'TRIAL_ACCEPTED' }))
      .status,
    200
  );
  assert.equal(
    (await call('/applications/' + application, player, 'PATCH', { status_code: 'WITHDRAWN' }))
      .status,
    200
  );
  const history = await call('/applications/' + application, player);
  assert.deepEqual(
    history.data.history.map((h) => h.new_status_code),
    ['SENT', 'TRIAL_PROPOSED', 'TRIAL_ACCEPTED', 'WITHDRAWN']
  );
  assert.equal((await call('/ads/' + ad + '/applications', player, 'POST', {})).status, 201);
});
test('fiche sportive : partage explicite, contacts privés masqués et limites', async () => {
  await pool.query('INSERT INTO player_profiles(user_id,first_name,last_name) VALUES($1,$2,$3)', [
    player.id,
    'Joël',
    'Test'
  ]);
  await pool.query(
    "UPDATE users SET phone='0600000000',location='Adresse privée',email_visible=FALSE,phone_visible=FALSE,location_visible=FALSE WHERE id=$1",
    [player.id]
  );
  const save = await call('/sport-profile/me', player, 'PATCH', {
    positions: ['STRIKER', 'RIGHT_WINGER'],
    qualities: ['SPEED', 'TEAMWORK'],
    sport_stats: { appearances: 12, goals: 3 },
    sport_city: 'Colmar',
    is_public: false
  });
  assert.equal(save.status, 200, JSON.stringify(save));
  assert.equal((await call('/profiles/' + player.id, club)).data.shared, false);
  assert.equal(
    (await call('/conversations/' + conversation, player, 'PATCH', { share_profile: true })).status,
    204
  );
  const shared = await call('/profiles/' + player.id + '?conversation_id=' + conversation, club);
  assert.equal(shared.status, 200);
  assert.equal(shared.data.shared, true);
  assert.equal(shared.data.profile.email, null);
  assert.equal(shared.data.profile.phone, null);
  assert.equal(shared.data.profile.city, 'Colmar');
  assert.equal(shared.data.profile.birth_date, undefined);
  assert.equal(
    (await call('/profiles/' + player.id + '?conversation_id=' + conversation, third)).status,
    404
  );
  assert.equal(
    (await call('/sport-profile/me', player, 'PATCH', { sport_stats: { goals: -1 } })).status,
    400
  );
  assert.equal(
    (
      await call('/sport-profile/me', player, 'PATCH', {
        positions: ['STRIKER', 'RIGHT_WINGER', 'LEFT_WINGER', 'LEFT_BACK', 'RIGHT_BACK']
      })
    ).status,
    400
  );
});
test('blocage et signalements : contrôle serveur et modération sans ouvrir les conversations privées', async () => {
  const reply = await call('/conversations/' + conversation + '/messages', club, 'POST', {
    message_body: 'Réponse du club',
    client_nonce: randomUUID()
  });
  assert.equal(reply.status, 201);
  const report = await call('/reports', player, 'POST', {
    conversation_id: conversation,
    message_id: reply.data.message.id,
    reason_code: 'SPAM'
  });
  assert.equal(report.status, 201);
  assert.equal((await call('/admin/reports', player)).status, 403);
  const adminList = await call('/admin/reports', admin);
  assert.ok(adminList.data.items.some((r) => r.id === report.data.id));
  assert.equal(
    (await call('/admin/reports/' + report.data.id, admin, 'PATCH', { status_code: 'RESOLVED' }))
      .status,
    204
  );
  assert.equal((await call('/blocks', player, 'POST', { user_id: club.id })).status, 201);
  assert.equal(
    (
      await call('/conversations/' + conversation + '/messages', club, 'POST', {
        message_body: 'Bloqué',
        client_nonce: randomUUID()
      })
    ).status,
    403
  );
  assert.equal(
    (await call('/conversations', player, 'POST', { club_id: club.clubId })).status,
    403
  );
  assert.equal((await call('/blocks/' + club.id, player, 'DELETE')).status, 204);
});
test('représentant multi-rôle : droits accordés par admin, jamais par le formulaire', async () => {
  assert.equal(
    (
      await call('/admin/club-memberships', member, 'POST', {
        user_id: member.id,
        club_id: club.clubId,
        is_active: true
      })
    ).status,
    403
  );
  assert.equal(
    (
      await call('/conversations', member, 'POST', {
        as_club_id: club.clubId,
        player_user_id: third.id
      })
    ).status,
    403
  );
  assert.equal(
    (
      await call('/admin/club-memberships', admin, 'POST', {
        user_id: member.id,
        club_id: club.clubId,
        is_active: true
      })
    ).status,
    201
  );
  const result = await call('/conversations', member, 'POST', {
    as_club_id: club.clubId,
    player_user_id: third.id
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  assert.equal((await call('/conversations/' + result.data.id, club)).status, 200);
  assert.equal((await call('/conversations/' + result.data.id, otherClub)).status, 404);
  assert.equal(
    (
      await call('/admin/club-memberships', admin, 'POST', {
        user_id: member.id,
        club_id: club.clubId,
        is_active: false
      })
    ).status,
    201
  );
  assert.equal((await call('/conversations/' + result.data.id, member)).status, 404);
});
test('protection d’origine et contraintes SQL des participants', async () => {
  assert.equal(
    (
      await call(
        '/conversations',
        player,
        'POST',
        { club_id: club.clubId },
        { Origin: 'https://attaque.invalid' }
      )
    ).status,
    403
  );
  await assert.rejects(
    pool.query('INSERT INTO conversation_participants(conversation_id,user_id) VALUES($1,$2)', [
      conversation,
      third.id
    ]),
    (error) => error.code === '23514'
  );
  const own = await call('/conversations/' + conversation, player);
  assert.ok(own.data.participant_id);
  await assert.rejects(
    pool.query(
      'INSERT INTO messages(conversation_id,sender_participant_id,sent_by_user_id,message_body,client_nonce) VALUES($1,$2,$3,$4,$5)',
      [conversation, own.data.participant_id, third.id, 'Intrusion SQL', randomUUID()]
    ),
    (error) => error.code === '23514'
  );
});

test('limites SQL transactionnelles, expiration et archivage limité à son identité', async () => {
  await assert.rejects(
    pool.query(
      `INSERT INTO ad_positions(ad_id,position_code) VALUES($1,'LEFT_BACK'),($1,'RIGHT_BACK'),($1,'CENTRE_BACK')`,
      [ad]
    ),
    (error) => error.code === '23514'
  );
  assert.deepEqual(
    (await pool.query('SELECT position_code FROM ad_positions WHERE ad_id=$1', [ad])).rows.map(
      (r) => r.position_code
    ),
    ['STRIKER']
  );
  assert.equal(
    (await call('/conversations/' + conversation, player, 'PATCH', { archived: true })).status,
    204
  );
  assert.ok(!(await call('/conversations', player)).data.items.some((c) => c.id === conversation));
  assert.ok(
    (await call('/conversations?filter=archived', player)).data.items.some(
      (c) => c.id === conversation
    )
  );
  assert.ok((await call('/conversations', club)).data.items.some((c) => c.id === conversation));
  await pool.query("UPDATE ads SET expires_at=now()-interval '1 second' WHERE id=$1", [ad]);
  assert.equal((await call('/ads/' + ad + '?view=market', null)).status, 404);
  assert.equal((await call('/ads/' + ad, null)).status, 404);
  assert.equal((await call('/ads/' + ad + '/applications', third, 'POST', {})).status, 404);
  await call('/ads/' + ad + '/renew', club, 'POST', {});
});

test('historique paginé sans recouvrement et suppression admin conservant les conversations de contexte', async () => {
  const participant = (await call('/conversations/' + conversation, player)).data.participant_id;
  await pool.query(
    `INSERT INTO messages(conversation_id,sender_participant_id,sent_by_user_id,message_body,client_nonce) SELECT $1,$2,$3,'Historique '||i,gen_random_uuid() FROM generate_series(1,33) i`,
    [conversation, participant, player.id]
  );
  const first = (await call('/conversations/' + conversation + '/messages', club)).data;
  assert.equal(first.items.length, 30);
  assert.ok(first.next_before);
  const previous = (
    await call('/conversations/' + conversation + '/messages?before=' + first.next_before, club)
  ).data;
  assert.ok(previous.items.length > 0);
  assert.ok(previous.items.every((p) => !first.items.some((m) => m.id === p.id)));
  const { deleteAd, deleteUser } = require('../backend/admin/deletion'),
    { transaction } = require('../backend/messaging/core');
  await transaction(pool, admin.id, (c) => deleteAd(c, ad));
  assert.equal((await pool.query('SELECT 1 FROM ads WHERE id=$1', [ad])).rows.length, 0);
  assert.ok(
    (await call('/conversations', player)).data.items.some((c) => c.announcement_id === null)
  );
  await transaction(pool, admin.id, (c) => deleteUser(c, otherClub.id, admin.id));
  assert.equal(
    (await pool.query('SELECT 1 FROM users WHERE id=$1', [otherClub.id])).rows.length,
    0
  );
  for (let index = 0; index < 2; index++) {
    const reply = await call('/conversations/' + conversation + '/messages', club, 'POST', {
      message_body: 'Message signalé ' + index,
      client_nonce: randomUUID()
    });
    assert.equal(reply.status, 201);
    assert.equal(
      (
        await call('/reports', player, 'POST', {
          conversation_id: conversation,
          message_id: reply.data.message.id,
          reason_code: 'SPAM'
        })
      ).status,
      201
    );
  }
  await transaction(pool, admin.id, (c) => deleteUser(c, club.id, admin.id));
  assert.equal(
    (await pool.query('SELECT 1 FROM conversations WHERE club_id=$1', [club.clubId])).rows.length,
    0
  );
  assert.equal(
    (await pool.query('SELECT 1 FROM messages WHERE conversation_id=$1', [conversation])).rows
      .length,
    0
  );
  assert.equal((await pool.query('SELECT 1 FROM users WHERE id=$1', [player.id])).rows.length, 1);
});
