const {
  fail,
  id,
  body,
  text,
  access,
  blockCheck,
  lockPeople,
  recipients,
  notify,
  audit
} = require('./core');

async function identities(client, userId) {
  const clubs = (
    await client.query(
      `SELECT c.id,c.name,c.city,c.user_id FROM clubs c WHERE messaging_manages_club($1,c.id) ORDER BY c.name,c.id`,
      [userId]
    )
  ).rows;
  const user = (
    await client.query('SELECT id,username,upper(role) AS role,status FROM users WHERE id=$1', [
      userId
    ])
  ).rows[0];
  return { user, clubs };
}

async function createConversation(client, identity, input) {
  body(input, ['club_id', 'player_user_id', 'announcement_id', 'as_club_id', 'share_profile']);
  if (input.share_profile !== undefined && typeof input.share_profile !== 'boolean')
    fail(400, 'INVALID_FIELD');
  const own = await identities(client, identity.userId);
  const asClub = input.as_club_id
    ? id(input.as_club_id)
    : identity.role === 'CLUB' && own.clubs.length === 1
      ? own.clubs[0].id
      : null;
  let clubId = asClub || (input.club_id ? id(input.club_id) : null);
  if (asClub && input.club_id && id(input.club_id) !== asClub) fail(403, 'CLUB_ACCESS_DENIED');
  let playerId = asClub
    ? input.player_user_id
      ? id(input.player_user_id)
      : null
    : identity.userId;
  let ad;
  if (input.announcement_id) {
    ad = (
      await client.query(
        `SELECT * FROM ads WHERE id=$1 AND status='PUBLISHED'
      AND (expires_at IS NULL OR expires_at>now()) FOR SHARE`,
        [id(input.announcement_id)]
      )
    ).rows[0];
    if (!ad) fail(404, 'AD_NOT_FOUND');
    if (ad.announcement_type === 'PLAYER_SEARCH') {
      if (!asClub) fail(403, 'CLUB_IDENTITY_REQUIRED');
      playerId = ad.author_id;
    } else {
      if (asClub) fail(403, 'PLAYER_IDENTITY_REQUIRED');
      clubId = ad.club_id;
    }
  }
  if (!clubId || !playerId) fail(400, 'IDENTITY_REQUIRED', 'Choisissez un joueur et un club.');
  if (asClub && !own.clubs.some((club) => club.id === asClub)) fail(403, 'CLUB_ACCESS_DENIED');
  if (!asClub && identity.role !== 'PLAYER') fail(403, 'PLAYER_IDENTITY_REQUIRED');
  if (!asClub && input.player_user_id !== undefined && id(input.player_user_id) !== identity.userId)
    fail(403, 'IDENTITY_DENIED');
  const club = (
    await client.query(
      `SELECT c.*,u.status FROM clubs c JOIN users u ON u.id=c.user_id WHERE c.id=$1`,
      [clubId]
    )
  ).rows[0];
  const player = (
    await client.query(
      "SELECT id FROM users WHERE id=$1 AND upper(role)='PLAYER' AND status='ACTIVE'",
      [playerId]
    )
  ).rows[0];
  if (!club || club.status !== 'ACTIVE' || !player) fail(404, 'CONTACT_UNAVAILABLE');
  if (playerId === club.user_id || (asClub && playerId === identity.userId))
    fail(400, 'SELF_CONTACT');
  await lockPeople(client, [playerId, club.user_id, identity.userId]);
  await blockCheck(client, playerId, club.user_id, identity.userId);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `conversation:${playerId}:${clubId}:${ad?.id || 0}`
  ]);
  const context = ad ? `ad:${ad.id}` : 'direct';
  let conversation = (
    await client.query(
      `SELECT * FROM conversations WHERE player_user_id=$1 AND club_id=$2 AND context_key=$3`,
      [playerId, clubId, context]
    )
  ).rows[0];
  let created = false;
  if (!conversation) {
    conversation = (
      await client.query(
        `INSERT INTO conversations(player_user_id,club_id,announcement_id,created_by_user_id,context_key) VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [playerId, clubId, ad?.id || null, identity.userId, context]
      )
    ).rows[0];
    await client.query(
      `INSERT INTO conversation_participants(conversation_id,user_id,club_id,share_profile)
      VALUES($1,$2,NULL,$4),($1,$3,$5,FALSE)`,
      [conversation.id, playerId, club.user_id, !asClub && input.share_profile === true, clubId]
    );
    await notify(
      client,
      (await recipients(client, conversation)).filter((user) => user !== identity.userId),
      'CONTACT',
      `contact:${conversation.id}`,
      { conversation_id: conversation.id, announcement_id: ad?.id }
    );
    await audit(client, identity.userId, 'CREATE_CONVERSATION', 'conversation', conversation.id);
    created = true;
  }
  const side = await access(client, identity.userId, conversation.id);
  await client.query('UPDATE conversation_participants SET archived_at=NULL WHERE id=$1', [
    side.participant_id
  ]);
  return { conversation, created };
}

async function listConversations(pool, userId, query) {
  const filter = query.filter || 'all';
  if (!['all', 'unread', 'players', 'clubs', 'applications', 'archived'].includes(filter))
    fail(400, 'INVALID_FILTER');
  const limit = 30;
  let beforeTime = query.before_time || null,
    beforeId = query.before_id ? id(query.before_id) : null;
  if (beforeTime && (!beforeId || Number.isNaN(Date.parse(beforeTime))))
    fail(400, 'INVALID_CURSOR');
  const { rows } = await pool.query(
    `SELECT c.id,c.announcement_id,c.application_id,c.last_message_at,c.updated_at,
    p.club_id AS acting_club_id,p.archived_at,p.share_profile,
    CASE WHEN p.club_id IS NULL THEN cl.name ELSE u.username END AS peer_name,
    CASE WHEN p.club_id IS NULL THEN 'CLUB' ELSE 'PLAYER' END AS peer_role,
    CASE WHEN p.club_id IS NULL THEN cl.user_id ELSE u.id END AS peer_user_id,
    CASE WHEN p.club_id IS NULL THEN cu.photo_url ELSE u.photo_url END AS peer_avatar,
    last.message_body AS last_message,last.created_at AS last_message_created_at,
    (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.sender_participant_id<>p.id AND m.deleted_at IS NULL AND m.id>coalesce(p.last_read_message_id,0)) AS unread_count,
    ap.status_code AS application_status
    FROM conversations c JOIN conversation_participants p ON p.conversation_id=c.id
    JOIN clubs cl ON cl.id=c.club_id JOIN users cu ON cu.id=cl.user_id JOIN users u ON u.id=c.player_user_id
    LEFT JOIN applications ap ON ap.id=c.application_id
    LEFT JOIN LATERAL(SELECT message_body,created_at FROM messages WHERE conversation_id=c.id AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) last ON TRUE
    WHERE p.deleted_at IS NULL AND ((p.club_id IS NULL AND p.user_id=$1) OR (p.club_id=c.club_id AND messaging_manages_club($1,c.club_id)))
    AND (($2='archived' AND p.archived_at IS NOT NULL) OR ($2<>'archived' AND p.archived_at IS NULL))
    AND ($2<>'players' OR p.club_id IS NOT NULL) AND ($2<>'clubs' OR p.club_id IS NULL)
    AND ($2<>'applications' OR c.application_id IS NOT NULL)
    AND ($2<>'unread' OR EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.sender_participant_id<>p.id AND m.deleted_at IS NULL AND m.id>coalesce(p.last_read_message_id,0)))
    AND ($3::timestamptz IS NULL OR (c.updated_at,c.id)<($3::timestamptz,$4::int))
    ORDER BY c.updated_at DESC,c.id DESC LIMIT $5`,
    [userId, filter, beforeTime, beforeId, limit + 1]
  );
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    next: rows.length > limit ? { before_time: last.updated_at, before_id: last.id } : null
  };
}

async function sendMessage(client, userId, conversationId, input) {
  body(input, ['message_body', 'client_nonce']);
  const message = text(input.message_body);
  if (
    typeof input.client_nonce !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.client_nonce)
  )
    fail(400, 'NONCE_REQUIRED');
  const c = await access(client, userId, conversationId, true);
  await lockPeople(client, [userId, c.player_user_id, c.club_user_id]);
  await blockCheck(client, c.player_user_id, c.club_user_id, userId);
  const old = (
    await client.query(
      'SELECT * FROM messages WHERE sender_participant_id=$1 AND client_nonce=$2',
      [c.participant_id, input.client_nonce]
    )
  ).rows[0];
  if (old) {
    if (old.message_body !== message) fail(409, 'NONCE_CONFLICT');
    return { message: old, created: false };
  }
  const row = (
    await client.query(
      `INSERT INTO messages(conversation_id,sender_participant_id,sent_by_user_id,message_body,client_nonce) VALUES($1,$2,$3,$4,$5) RETURNING id,conversation_id,sender_participant_id,message_body,created_at`,
      [c.id, c.participant_id, userId, message, input.client_nonce]
    )
  ).rows[0];
  await client.query(
    'UPDATE conversations SET last_message_at=$2,updated_at=clock_timestamp() WHERE id=$1',
    [c.id, row.created_at]
  );
  await client.query(
    'UPDATE conversation_participants SET archived_at=NULL WHERE conversation_id=$1',
    [c.id]
  );
  if (
    c.application_id &&
    (c.participant_club_id ||
      (
        await client.query(
          'SELECT 1 FROM messages WHERE conversation_id=$1 AND sender_participant_id<>$2 LIMIT 1',
          [c.id, c.participant_id]
        )
      ).rows.length)
  )
    await client.query(
      "UPDATE applications SET status_code='DISCUSSING',updated_at=now() WHERE id=$1 AND status_code IN ('SENT','VIEWED')",
      [c.application_id]
    );
  await notify(
    client,
    (await recipients(client, c)).filter((user) => user !== userId),
    'MESSAGE',
    `message:${row.id}`,
    { conversation_id: c.id, message_id: row.id, application_id: c.application_id }
  );
  return { message: row, created: true };
}
module.exports = { identities, createConversation, listConversations, sendMessage };
