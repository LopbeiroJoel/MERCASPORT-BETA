const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const express = require('express');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { configureApp } = require('../backend/app');
const { createSessionService } = require('../backend/authentication/session');
const { brokerFor } = require('../backend/messaging/realtime');
if (process.env.MESSAGING_ISOLATED_TEST !== '1' || process.env.PGPORT !== '15439')
  throw new Error('Lancer npm run test:messaging:live dans une base jetable.');
const pool = new Pool(),
  otherPool = new Pool(),
  secret = '1234567890abcdef'.repeat(4),
  origin = 'http://localhost:3001';
let app1, app2, url1, url2, player, club, third, cid;
async function account(role, name) {
  const u = (
    await pool.query(
      "INSERT INTO users(name,username,email,password_hash,role,status) VALUES($1,$1,$2,'fixture-hash',$3,'ACTIVE') RETURNING *",
      [name, name + '@example.invalid', role]
    )
  ).rows[0];
  if (role === 'CLUB')
    u.clubId = (
      await pool.query('INSERT INTO clubs(user_id,name,city) VALUES($1,$2,$3) RETURNING id', [
        u.id,
        name,
        'Colmar'
      ])
    ).rows[0].id;
  await createSessionService(pool, { secret, origins: [origin], allowLocalHttp: true }).issue(u, {
    cookie: (name, token) => (u.cookie = name + '=' + token)
  });
  return u;
}
async function call(url, path, user, method = 'GET', data) {
  const res = await fetch(url + path, {
    method,
    headers: {
      Cookie: user.cookie,
      ...(data ? { 'Content-Type': 'application/json', Origin: origin } : {})
    },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}
async function events(url, user) {
  const controller = new AbortController();
  const res = await fetch(url + '/messaging/events', {
    headers: { Cookie: user.cookie },
    signal: controller.signal
  });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  let text = '';
  return {
    controller,
    async until(marker) {
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        while (!text.includes(marker)) {
          const next = await reader.read();
          if (next.done) throw new Error('Flux fermé avant réception');
          text += new TextDecoder().decode(next.value);
        }
        return text;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
before(async () => {
  player = await account('PLAYER', 'live-player');
  club = await account('CLUB', 'live-club');
  third = await account('PLAYER', 'live-third');
  app1 = configureApp(express(), pool, { authSecret: secret, appOrigin: origin }).listen(
    0,
    '127.0.0.1'
  );
  app2 = configureApp(express(), otherPool, { authSecret: secret, appOrigin: origin }).listen(
    0,
    '127.0.0.1'
  );
  await Promise.all([once(app1, 'listening'), once(app2, 'listening')]);
  url1 = 'http://127.0.0.1:' + app1.address().port;
  url2 = 'http://127.0.0.1:' + app2.address().port;
  const created = await call(url1, '/conversations', player, 'POST', { club_id: club.clubId });
  assert.equal(created.status, 201);
  cid = created.data.id;
});
after(async () => {
  brokerFor(pool).close();
  brokerFor(otherPool).close();
  for (const app of [app1, app2]) {
    app?.closeAllConnections();
    if (app) await new Promise((r) => app.close(r));
  }
  await Promise.all([pool.end(), otherPool.end()]);
});
test('SSE réel entre deux instances : seuls les destinataires reçoivent un identifiant, jamais le texte', async () => {
  const recipient = await events(url2, club),
    stranger = await events(url2, third);
  try {
    await recipient.until('event: ready');
    await stranger.until('event: ready');
    const sent = await call(url1, `/conversations/${cid}/messages`, player, 'POST', {
      message_body: 'Message confidentiel live',
      client_nonce: randomUUID()
    });
    assert.equal(sent.status, 201);
    const event = await recipient.until('event: refresh');
    assert.ok(event.includes('"conversation_id":' + cid));
    assert.ok(!event.includes('Message confidentiel'));
    const privateRead = await call(url2, `/conversations/${cid}/messages`, club);
    assert.equal(privateRead.data.items.at(-1).message_body, 'Message confidentiel live');
    assert.equal((await call(url2, `/conversations/${cid}/messages`, third)).status, 404);
    const isolatedBroker = brokerFor(otherPool);
    let thirdEvents = 0;
    const unsubscribe = await isolatedBroker.subscribe(
      third.id,
      () => thirdEvents++,
      () => {}
    );
    await call(url1, `/conversations/${cid}/messages`, club, 'POST', {
      message_body: 'Réponse en direct',
      client_nonce: randomUUID()
    });
    await new Promise((r) => setTimeout(r, 150));
    unsubscribe();
    assert.equal(thirdEvents, 0);
  } finally {
    recipient.controller.abort();
    stranger.controller.abort();
  }
});
test('concurrence PostgreSQL : même contexte et nonce sans doublon', async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      call(url1, '/conversations', player, 'POST', { club_id: club.clubId })
    )
  );
  assert.ok(results.every((r) => r.data.id === cid));
  const body = { message_body: 'Envoi concurrent', client_nonce: randomUUID() };
  const messages = await Promise.all([
    call(url1, `/conversations/${cid}/messages`, player, 'POST', body),
    call(url2, `/conversations/${cid}/messages`, player, 'POST', body)
  ]);
  assert.deepEqual(messages.map((r) => r.status).sort(), [200, 201]);
  assert.equal(messages[0].data.message.id, messages[1].data.message.id);
});
