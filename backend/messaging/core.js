const { createSqlRateLimiter } = require('../authentication/rate-limit');

function fail(status, code, message) {
  throw Object.assign(new Error(message || code), { status, code });
}
function id(value) {
  if (!/^[1-9]\d{0,9}$/.test(String(value)) || Number(value) > 2147483647) fail(400, 'INVALID_ID');
  return Number(value);
}
function messageId(value) {
  if (!/^[1-9]\d{0,18}$/.test(String(value)) || BigInt(value) > 9223372036854775807n)
    fail(400, 'INVALID_ID');
  return String(value);
}
function body(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_BODY');
  if (Object.keys(value).some((key) => !fields.includes(key))) fail(400, 'UNKNOWN_FIELDS');
  return value;
}
function text(value, max = 4000, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    fail(400, 'INVALID_TEXT');
  return value.trim();
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
async function transaction(pool, userId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('mercasport.actor_id',$1,true)", [String(userId)]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
function auth(sessions) {
  return wrap(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!sessions) fail(503, 'AUTH_NOT_CONFIGURED');
    const writing = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (writing && !sessions.allowsOrigin(req)) fail(403, 'ORIGIN_DENIED');
    if (writing && req.method !== 'DELETE' && !req.is('application/json'))
      fail(415, 'JSON_REQUIRED');
    const identity = await sessions.authenticate(req);
    if (!identity) fail(401, 'AUTH_REQUIRED');
    if (writing && identity.status !== 'ACTIVE')
      fail(403, 'ACTIVE_ACCOUNT_REQUIRED', 'Votre compte doit être activé pour cette action.');
    req.identity = identity;
    next();
  });
}
function limiter(pool, sessions, name, count, windowMs) {
  const service =
    sessions && createSqlRateLimiter(pool, sessions.rateKey, { maxAttempts: count, windowMs });
  return wrap(async (req, res, next) => {
    if (!service || !(await service.allow(`${name}:${req.identity.userId}`))) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      fail(429, 'TOO_MANY_REQUESTS', 'Trop de demandes. Réessayez dans un instant.');
    }
    next();
  });
}
async function manages(client, userId, clubId) {
  return (await client.query('SELECT messaging_manages_club($1,$2) AS allowed', [userId, clubId]))
    .rows[0].allowed;
}
async function access(client, userId, conversationId, lock = false) {
  const { rows } = await client.query(
    `SELECT c.*,cl.user_id AS club_user_id,cl.name AS club_name,
    p.id AS participant_id,p.club_id AS participant_club_id,p.last_read_message_id,p.share_profile,p.archived_at
    FROM conversations c JOIN clubs cl ON cl.id=c.club_id
    JOIN conversation_participants p ON p.conversation_id=c.id AND p.deleted_at IS NULL
    WHERE c.id=$1 AND ((p.club_id IS NULL AND p.user_id=$2)
      OR (p.club_id=c.club_id AND messaging_manages_club($2,c.club_id))) ${lock ? 'FOR UPDATE OF c,p' : ''}`,
    [id(conversationId), userId]
  );
  if (rows.length !== 1) fail(404, 'CONVERSATION_NOT_FOUND');
  return rows[0];
}
async function blockCheck(client, playerId, clubUserId, actorId) {
  const { rows } = await client.query(
    `SELECT 1 FROM user_blocks
    WHERE (blocker_user_id=$1 AND blocked_user_id=ANY($2::int[]))
       OR (blocked_user_id=$1 AND blocker_user_id=ANY($2::int[])) LIMIT 1`,
    [playerId, [...new Set([clubUserId, actorId])]]
  );
  if (rows.length) fail(403, 'CONTACT_BLOCKED', 'Les échanges sont bloqués entre ces comptes.');
}
async function lockPeople(client, ids) {
  await client.query('SELECT id FROM users WHERE id=ANY($1::int[]) ORDER BY id FOR SHARE', [
    [...new Set(ids)]
  ]);
}
async function recipients(client, conversation) {
  const { rows } = await client.query(
    `SELECT $1::int AS id UNION SELECT user_id FROM clubs WHERE id=$2
    UNION SELECT user_id FROM club_memberships WHERE club_id=$2 AND is_active`,
    [conversation.player_user_id, conversation.club_id]
  );
  return rows.map((row) => row.id).filter(Boolean);
}
async function notify(client, users, type, key, refs = {}) {
  const unique = [...new Set(users)].filter(Boolean);
  for (const userId of unique)
    await client.query(
      `INSERT INTO notifications
    (recipient_user_id,type_code,event_key,conversation_id,message_id,application_id,announcement_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(recipient_user_id,event_key) DO NOTHING`,
      [
        userId,
        type,
        key,
        refs.conversation_id || null,
        refs.message_id || null,
        refs.application_id || null,
        refs.announcement_id || null
      ]
    );
  if (unique.length)
    await client.query("SELECT pg_notify('mercasport_events',$1)", [
      JSON.stringify({ users: unique, conversation_id: refs.conversation_id || null })
    ]);
}
async function audit(client, userId, action, resource, resourceId) {
  await client.query(
    'INSERT INTO recruitment_audit(actor_user_id,action,resource_type,resource_id) VALUES($1,$2,$3,$4)',
    [userId, action, resource, String(resourceId)]
  );
}
function errors(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') return res.status(400).json({ code: 'INVALID_JSON' });
  if (error.type === 'entity.too.large') return res.status(413).json({ code: 'BODY_TOO_LARGE' });
  if (error.status)
    return res.status(error.status).json({ code: error.code, message: error.message });
  if (error.code === '23505') return res.status(409).json({ code: 'RESOURCE_CONFLICT' });
  if (['23503', '23514', '23502', '22001', '22P02', '22007', 'P0001'].includes(error.code))
    return res.status(400).json({ code: 'INVALID_DATA' });
  console.error('Recrutement indisponible :', error.code || error.name);
  res
    .status(503)
    .json({ code: 'MESSAGING_UNAVAILABLE', message: 'Service indisponible. Réessayez plus tard.' });
}
module.exports = {
  fail,
  id,
  messageId,
  body,
  text,
  wrap,
  transaction,
  auth,
  limiter,
  manages,
  access,
  blockCheck,
  lockPeople,
  recipients,
  notify,
  audit,
  errors
};
