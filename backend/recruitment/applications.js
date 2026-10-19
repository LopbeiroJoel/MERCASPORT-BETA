const {
  fail,
  id,
  body,
  text,
  access,
  manages,
  recipients,
  notify,
  audit
} = require('../messaging/core');
const { createConversation, sendMessage } = require('../messaging/conversations');
const { randomUUID } = require('node:crypto');

async function apply(client, identity, adId, input) {
  body(input, ['message', 'share_profile']);
  if (identity.role !== 'PLAYER') fail(403, 'PLAYER_REQUIRED');
  if (input.share_profile !== undefined && typeof input.share_profile !== 'boolean')
    fail(400, 'INVALID_FIELD');
  const message = text(input.message, 2000, true) || '';
  const ad = (
    await client.query(
      `SELECT * FROM ads WHERE id=$1 AND announcement_type='CLUB_SEARCH' AND status='PUBLISHED' AND (expires_at IS NULL OR expires_at>now()) FOR SHARE`,
      [id(adId)]
    )
  ).rows[0];
  if (!ad) fail(404, 'AD_NOT_FOUND');
  if (await manages(client, identity.userId, ad.club_id)) fail(400, 'OWN_CLUB_APPLICATION');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `application:${identity.userId}:${ad.id}`
  ]);
  const { conversation } = await createConversation(client, identity, {
    announcement_id: ad.id,
    share_profile: input.share_profile === true
  });
  let application = (
    await client.query(
      'SELECT * FROM applications WHERE ad_id=$1 AND player_user_id=$2 FOR UPDATE',
      [ad.id, identity.userId]
    )
  ).rows[0];
  let created = false;
  if (!application) {
    const user = (await client.query('SELECT name,email FROM users WHERE id=$1', [identity.userId]))
      .rows[0];
    const player = (
      await client.query('SELECT id FROM players WHERE user_id=$1', [identity.userId])
    ).rows[0];
    application = (
      await client.query(
        `INSERT INTO applications(ad_id,player_id,player_user_id,club_id,name,email,message,status_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,'SENT') RETURNING id,ad_id,player_user_id,club_id,status_code,created_at`,
        [ad.id, player?.id || null, identity.userId, ad.club_id, user.name, user.email, message]
      )
    ).rows[0];
    created = true;
  } else if (application.status_code === 'WITHDRAWN') {
    application = (
      await client.query(
        "UPDATE applications SET status_code='SENT',withdrawn_at=NULL,updated_at=now(),message=$2 WHERE id=$1 RETURNING id,ad_id,player_user_id,club_id,status_code,created_at",
        [application.id, message]
      )
    ).rows[0];
    created = true;
  }
  await client.query('UPDATE conversations SET application_id=$2 WHERE id=$1', [
    conversation.id,
    application.id
  ]);
  if (input.share_profile === true)
    await client.query(
      'UPDATE conversation_participants SET share_profile=TRUE WHERE conversation_id=$1 AND user_id=$2 AND club_id IS NULL',
      [conversation.id, identity.userId]
    );
  if (created) {
    const history = (
      await client.query(
        'SELECT id FROM application_status_history WHERE application_id=$1 ORDER BY id DESC LIMIT 1',
        [application.id]
      )
    ).rows[0];
    await notify(
      client,
      (await recipients(client, conversation)).filter((user) => user !== identity.userId),
      'APPLICATION',
      `application:${application.id}:${history.id}`,
      { conversation_id: conversation.id, application_id: application.id, announcement_id: ad.id }
    );
    await audit(client, identity.userId, 'APPLY', 'application', application.id);
    if (message)
      await sendMessage(client, identity.userId, conversation.id, {
        message_body: message,
        client_nonce: randomUUID()
      });
  }
  return {
    application: {
      id: application.id,
      ad_id: application.ad_id,
      player_user_id: application.player_user_id,
      club_id: application.club_id,
      status_code: application.status_code,
      created_at: application.created_at
    },
    conversation_id: conversation.id,
    created
  };
}

async function applicationAccess(client, userId, applicationId, lock = false) {
  const row = (
    await client.query(
      `SELECT ap.id,ap.ad_id,ap.player_user_id,ap.club_id,ap.status_code,ap.created_at,ap.updated_at,ap.message,
   c.id AS conversation_id,a.title,a.city,u.username AS player_name,cl.name AS club_name,
   (ap.player_user_id=$2) AS is_player,messaging_manages_club($2,ap.club_id) AS is_club
   FROM applications ap JOIN ads a ON a.id=ap.ad_id JOIN users u ON u.id=ap.player_user_id JOIN clubs cl ON cl.id=ap.club_id
   LEFT JOIN conversations c ON c.application_id=ap.id
   WHERE ap.id=$1 AND (ap.player_user_id=$2 OR messaging_manages_club($2,ap.club_id)) ${lock ? 'FOR UPDATE OF ap' : ''}`,
      [id(applicationId), userId]
    )
  ).rows[0];
  if (!row) fail(404, 'APPLICATION_NOT_FOUND');
  return row;
}
async function listApplications(pool, userId, query) {
  const before = query.before ? id(query.before) : 2147483647;
  const rows = (
    await pool.query(
      `SELECT ap.id,ap.ad_id,ap.player_user_id,ap.club_id,ap.status_code,ap.created_at,ap.updated_at,
   a.title,cl.name AS club_name,u.username AS player_name,c.id AS conversation_id,(ap.player_user_id=$1) AS is_player
   FROM applications ap JOIN ads a ON a.id=ap.ad_id JOIN clubs cl ON cl.id=ap.club_id JOIN users u ON u.id=ap.player_user_id
   LEFT JOIN conversations c ON c.application_id=ap.id
   WHERE (ap.player_user_id=$1 OR messaging_manages_club($1,ap.club_id)) AND ap.id<$2 ORDER BY ap.id DESC LIMIT 31`,
      [userId, before]
    )
  ).rows;
  return { items: rows.slice(0, 30), next: rows.length > 30 ? rows[29].id : null };
}
async function changeStatus(client, identity, applicationId, input) {
  body(input, ['status_code']);
  const next = input.status_code;
  if (typeof next !== 'string') fail(400, 'INVALID_STATUS');
  const app = await applicationAccess(client, identity.userId, applicationId, true);
  if (next === app.status_code) return app;
  const allowed = {
    SENT: ['VIEWED', 'DISCUSSING', 'TRIAL_PROPOSED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
    VIEWED: ['DISCUSSING', 'TRIAL_PROPOSED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
    DISCUSSING: ['TRIAL_PROPOSED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
    TRIAL_PROPOSED: ['TRIAL_ACCEPTED', 'DISCUSSING', 'REJECTED', 'WITHDRAWN'],
    TRIAL_ACCEPTED: ['ACCEPTED', 'REJECTED', 'WITHDRAWN']
  };
  if (!allowed[app.status_code]?.includes(next)) fail(409, 'INVALID_TRANSITION');
  if (['WITHDRAWN', 'TRIAL_ACCEPTED'].includes(next) ? !app.is_player : !app.is_club)
    fail(403, 'STATUS_PERMISSION_DENIED');
  await client.query(
    "UPDATE applications SET status_code=$2::varchar,updated_at=now(),withdrawn_at=CASE WHEN $2::varchar='WITHDRAWN' THEN now() ELSE NULL END WHERE id=$1",
    [app.id, next]
  );
  const c = await access(client, identity.userId, app.conversation_id);
  const event = (
    await client.query(
      'SELECT id FROM application_status_history WHERE application_id=$1 ORDER BY id DESC LIMIT 1',
      [app.id]
    )
  ).rows[0];
  const type =
    { VIEWED: 'VIEWED', TRIAL_PROPOSED: 'TRIAL_PROPOSED', TRIAL_ACCEPTED: 'TRIAL_ACCEPTED' }[
      next
    ] || 'STATUS';
  await notify(
    client,
    (await recipients(client, c)).filter((user) => user !== identity.userId),
    type,
    `status:${event.id}`,
    { conversation_id: c.id, application_id: app.id, announcement_id: app.ad_id }
  );
  await audit(client, identity.userId, 'APPLICATION_STATUS', 'application', app.id);
  return applicationAccess(client, identity.userId, app.id);
}
module.exports = { apply, applicationAccess, listApplications, changeStatus };
