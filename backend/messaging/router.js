const express = require('express');
const core = require('./core');
const {
  identities,
  createConversation,
  listConversations,
  sendMessage
} = require('./conversations');
const { playerProfile, clubProfile, ownProfile, saveOwnProfile } = require('./profiles');
const { stream } = require('./realtime');
const { fail, id, messageId, body, wrap, transaction, auth, limiter, access, audit } = core;

function createMessagingRouter(pool, sessions, { broker } = {}) {
  const router = express.Router(),
    A = auth(sessions),
    R = express.json({ limit: '16kb' });
  const tx = (req, fn) => transaction(pool, req.identity.userId, fn);
  router.get(
    '/messaging/identities',
    A,
    wrap(async (req, res) => res.json(await identities(pool, req.identity.userId)))
  );
  router.get(
    '/messaging/events',
    A,
    limiter(pool, sessions, 'live', 30, 300000),
    stream(pool, sessions, broker)
  );
  router.get(
    '/contacts',
    A,
    wrap(async (req, res) => {
      const search = core.text(req.query.q, 100);
      if (search.length < 2) return res.json({ items: [] });
      const own = await identities(pool, req.identity.userId);
      const players = own.clubs.length
        ? (
            await pool.query(
              `SELECT id AS user_id,username AS name,photo_url,'PLAYER' AS role FROM users WHERE upper(role)='PLAYER' AND status='ACTIVE' AND id<>$1 AND username ILIKE '%'||$2||'%' ORDER BY username LIMIT 20`,
              [req.identity.userId, search]
            )
          ).rows
        : [];
      const clubs =
        req.identity.role === 'PLAYER'
          ? (
              await pool.query(
                `SELECT c.id AS club_id,c.user_id,c.name,u.photo_url,'CLUB' AS role FROM clubs c JOIN users u ON u.id=c.user_id WHERE u.status='ACTIVE' AND c.user_id<>$1 AND c.name ILIKE '%'||$2||'%' ORDER BY c.name LIMIT 20`,
                [req.identity.userId, search]
              )
            ).rows
          : [];
      res.json({ items: [...clubs, ...players] });
    })
  );
  router.get(
    '/conversations',
    A,
    wrap(async (req, res) =>
      res.json(await listConversations(pool, req.identity.userId, req.query))
    )
  );
  router.post(
    '/conversations',
    A,
    R,
    limiter(pool, sessions, 'new-conversation', 15, 600000),
    wrap(async (req, res) => {
      const result = await tx(req, (c) => createConversation(c, req.identity, req.body));
      res
        .location('/conversations/' + result.conversation.id)
        .status(result.created ? 201 : 200)
        .json({ id: result.conversation.id, created: result.created });
    })
  );
  router.get(
    '/conversations/:id',
    A,
    wrap(async (req, res) => {
      const c = await access(pool, req.identity.userId, req.params.id);
      const peer = c.participant_club_id
        ? await pool.query('SELECT id,username AS name,photo_url FROM users WHERE id=$1', [
            c.player_user_id
          ])
        : await pool.query(
            'SELECT c.user_id AS id,c.name,u.photo_url FROM clubs c JOIN users u ON u.id=c.user_id WHERE c.id=$1',
            [c.club_id]
          );
      const blocks = await pool.query(
        'SELECT 1 FROM user_blocks WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1)',
        [c.player_user_id, c.club_user_id]
      );
      const application = c.application_id
        ? (
            await pool.query('SELECT id,status_code,ad_id FROM applications WHERE id=$1', [
              c.application_id
            ])
          ).rows[0]
        : null;
      res.json({
        id: c.id,
        participant_id: c.participant_id,
        acting_club_id: c.participant_club_id,
        announcement_id: c.announcement_id,
        peer: { ...peer.rows[0], role: c.participant_club_id ? 'PLAYER' : 'CLUB' },
        application,
        archived: !!c.archived_at,
        share_profile: c.share_profile,
        blocked: !!blocks.rows.length
      });
    })
  );
  router.get(
    '/conversations/:id/profile',
    A,
    wrap(async (req, res) => {
      const c = await access(pool, req.identity.userId, req.params.id);
      res.json(
        c.participant_club_id
          ? await playerProfile(pool, req.identity.userId, c.player_user_id, c.id)
          : await clubProfile(pool, c.club_id)
      );
    })
  );
  router.get(
    '/conversations/:id/messages',
    A,
    wrap(async (req, res) => {
      const c = await access(pool, req.identity.userId, req.params.id);
      if (req.query.before && req.query.after) fail(400, 'INVALID_CURSOR');
      const before = req.query.before ? messageId(req.query.before) : null,
        after = req.query.after ? messageId(req.query.after) : null;
      const rows = (
        await pool.query(
          `SELECT m.id,m.message_body,m.created_at,(m.sender_participant_id=$2) AS mine,
   (m.id<=coalesce(p.last_read_message_id,0)) AS read FROM messages m
   JOIN conversation_participants p ON p.conversation_id=m.conversation_id AND p.id<>m.sender_participant_id
   WHERE m.conversation_id=$1 AND m.deleted_at IS NULL AND ($3::bigint IS NULL OR m.id<$3::bigint) AND ($4::bigint IS NULL OR m.id>$4::bigint)
   ORDER BY m.id DESC LIMIT 31`,
          [c.id, c.participant_id, before, after]
        )
      ).rows;
      const items = rows.slice(0, 30).reverse();
      res.json({ items, next_before: rows.length > 30 ? items[0].id : null });
    })
  );
  router.post(
    '/conversations/:id/messages',
    A,
    R,
    limiter(pool, sessions, 'send-message', 40, 60000),
    wrap(async (req, res) => {
      const result = await tx(req, (c) =>
        sendMessage(c, req.identity.userId, req.params.id, req.body)
      );
      res.status(result.created ? 201 : 200).json({ message: result.message });
    })
  );
  router.patch(
    '/conversations/:id/read',
    A,
    R,
    wrap(async (req, res) => {
      body(req.body, ['last_message_id']);
      const last = messageId(req.body.last_message_id);
      await tx(req, async (client) => {
        const c = await access(client, req.identity.userId, req.params.id, true);
        const message = (
          await client.query(
            'SELECT id,created_at FROM messages WHERE id=$1 AND conversation_id=$2',
            [last, c.id]
          )
        ).rows[0];
        if (!message) fail(404, 'MESSAGE_NOT_FOUND');
        const changed = await client.query(
          'UPDATE conversation_participants SET last_read_at=$2,last_read_message_id=$3::bigint WHERE id=$1 AND coalesce(last_read_message_id,0)<$3::bigint RETURNING id',
          [c.participant_id, message.created_at, last]
        );
        await client.query(
          'UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE recipient_user_id=$1 AND conversation_id=$2 AND (message_id IS NULL OR message_id<=$3::bigint)',
          [req.identity.userId, c.id, last]
        );
        if (changed.rows.length)
          await client.query("SELECT pg_notify('mercasport_events',$1)", [
            JSON.stringify({ users: await core.recipients(client, c), conversation_id: c.id })
          ]);
      });
      res.status(204).end();
    })
  );
  router.patch(
    '/conversations/:id',
    A,
    R,
    wrap(async (req, res) => {
      body(req.body, ['archived', 'share_profile']);
      if (!Object.keys(req.body).length) fail(400, 'EMPTY_UPDATE');
      await tx(req, async (client) => {
        const c = await access(client, req.identity.userId, req.params.id, true);
        if (Object.hasOwn(req.body, 'archived')) {
          if (typeof req.body.archived !== 'boolean') fail(400, 'INVALID_FIELD');
          await client.query(
            'UPDATE conversation_participants SET archived_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1',
            [c.participant_id, req.body.archived]
          );
        }
        if (Object.hasOwn(req.body, 'share_profile')) {
          if (c.participant_club_id || typeof req.body.share_profile !== 'boolean')
            fail(403, 'PROFILE_PERMISSION_DENIED');
          await client.query('UPDATE conversation_participants SET share_profile=$2 WHERE id=$1', [
            c.participant_id,
            req.body.share_profile
          ]);
        }
        await audit(client, req.identity.userId, 'UPDATE_CONVERSATION', 'conversation', c.id);
        await client.query("SELECT pg_notify('mercasport_events',$1)", [
          JSON.stringify({ users: await core.recipients(client, c), conversation_id: c.id })
        ]);
      });
      res.status(204).end();
    })
  );
  router.get(
    '/notifications',
    A,
    wrap(async (req, res) => {
      const before = req.query.before ? messageId(req.query.before) : '9223372036854775807';
      const rows = (
        await pool.query(
          'SELECT id,type_code,conversation_id,message_id,application_id,announcement_id,created_at,read_at FROM notifications WHERE recipient_user_id=$1 AND id<$2::bigint ORDER BY id DESC LIMIT 31',
          [req.identity.userId, before]
        )
      ).rows;
      const unread = (
        await pool.query(
          'SELECT count(*)::int AS count FROM notifications WHERE recipient_user_id=$1 AND read_at IS NULL',
          [req.identity.userId]
        )
      ).rows[0].count;
      res.json({ items: rows.slice(0, 30), unread, next: rows.length > 30 ? rows[29].id : null });
    })
  );
  router.patch(
    '/notifications/:id',
    A,
    R,
    wrap(async (req, res) => {
      body(req.body, []);
      const result = await pool.query(
        'UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND recipient_user_id=$2 RETURNING id',
        [messageId(req.params.id), req.identity.userId]
      );
      if (!result.rows.length) fail(404, 'NOTIFICATION_NOT_FOUND');
      res.status(204).end();
    })
  );
  router.get(
    '/blocks',
    A,
    wrap(async (req, res) =>
      res.json({
        items: (
          await pool.query(
            'SELECT b.blocked_user_id,u.username FROM user_blocks b JOIN users u ON u.id=b.blocked_user_id WHERE b.blocker_user_id=$1 ORDER BY b.created_at DESC',
            [req.identity.userId]
          )
        ).rows
      })
    )
  );
  router.post(
    '/blocks',
    A,
    R,
    limiter(pool, sessions, 'blocks', 30, 600000),
    wrap(async (req, res) => {
      body(req.body, ['user_id']);
      const target = id(req.body.user_id);
      if (target === req.identity.userId) fail(400, 'SELF_BLOCK');
      await tx(req, async (client) => {
        const users = await client.query(
          'SELECT id FROM users WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',
          [[req.identity.userId, target]]
        );
        if (users.rows.length !== 2) fail(404, 'USER_NOT_FOUND');
        await client.query(
          'INSERT INTO user_blocks(blocker_user_id,blocked_user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [req.identity.userId, target]
        );
        await audit(client, req.identity.userId, 'BLOCK', 'user', target);
      });
      res.status(201).json({ blocked: true });
    })
  );
  router.delete(
    '/blocks/:id',
    A,
    wrap(async (req, res) => {
      await tx(req, async (client) => {
        await client.query(
          'DELETE FROM user_blocks WHERE blocker_user_id=$1 AND blocked_user_id=$2',
          [req.identity.userId, id(req.params.id)]
        );
        await audit(client, req.identity.userId, 'UNBLOCK', 'user', req.params.id);
      });
      res.status(204).end();
    })
  );
  router.post(
    '/reports',
    A,
    R,
    limiter(pool, sessions, 'reports', 10, 3600000),
    wrap(async (req, res) => {
      body(req.body, ['conversation_id', 'message_id', 'reason_code']);
      const report = await tx(req, async (client) => {
        const c = await access(client, req.identity.userId, req.body.conversation_id);
        const reason = await client.query(
          'SELECT 1 FROM report_reasons WHERE code=$1 AND is_active',
          [req.body.reason_code]
        );
        if (!reason.rows.length) fail(400, 'INVALID_REASON');
        const mid = req.body.message_id ? messageId(req.body.message_id) : null;
        if (
          mid &&
          !(
            await client.query(
              'SELECT 1 FROM messages WHERE id=$1 AND conversation_id=$2 AND sender_participant_id<>$3',
              [mid, c.id, c.participant_id]
            )
          ).rows.length
        )
          fail(404, 'MESSAGE_NOT_FOUND');
        const target = c.participant_club_id ? c.player_user_id : c.club_user_id;
        const result = await client.query(
          `INSERT INTO reports(reporter_user_id,reported_user_id,conversation_id,message_id,reason_code) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
          [req.identity.userId, target, c.id, mid, req.body.reason_code]
        );
        await audit(client, req.identity.userId, 'REPORT', 'conversation', c.id);
        return result.rows[0] || { duplicate: true };
      });
      res.status(201).json(report);
    })
  );
  router.get(
    '/sport-profile/me',
    A,
    wrap(async (req, res) => res.json(await ownProfile(pool, req.identity.userId)))
  );
  router.patch(
    '/sport-profile/me',
    A,
    R,
    wrap(async (req, res) =>
      res.json(await tx(req, (c) => saveOwnProfile(c, req.identity, req.body)))
    )
  );
  router.get(
    '/profiles/:id',
    A,
    wrap(async (req, res) =>
      res.json(
        await playerProfile(pool, req.identity.userId, req.params.id, req.query.conversation_id)
      )
    )
  );
  router.get(
    '/clubs/:id/public-profile',
    A,
    wrap(async (req, res) => res.json(await clubProfile(pool, req.params.id)))
  );
  router.use(core.errors);
  return router;
}
module.exports = { createMessagingRouter };
