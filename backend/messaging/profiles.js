const { fail, id, body, text, access, blockCheck } = require('./core');

async function clubProfile(client, clubId) {
  const row = (
    await client.query(
      `SELECT c.id,c.user_id,c.name,c.city,c.divisions,u.photo_url,
    p.description,p.general_info,CASE WHEN u.email_visible THEN u.email END AS email,
    CASE WHEN u.phone_visible THEN u.phone END AS phone
    FROM clubs c JOIN users u ON u.id=c.user_id LEFT JOIN club_profiles p ON p.user_id=c.user_id
    WHERE c.id=$1 AND u.status NOT IN ('BANNED','DISABLED')`,
      [id(clubId)]
    )
  ).rows[0];
  if (!row) fail(404, 'PROFILE_NOT_FOUND');
  return {
    role: 'CLUB',
    shared: true,
    user: { id: row.user_id, username: row.name, photo_url: row.photo_url },
    profile: row
  };
}
async function playerProfile(client, viewerId, playerId, conversationId) {
  const user = (
    await client.query(
      `SELECT id,username,photo_url,status FROM users WHERE id=$1 AND upper(role)='PLAYER' AND status NOT IN ('BANNED','DISABLED')`,
      [id(playerId)]
    )
  ).rows[0];
  if (!user) fail(404, 'PROFILE_NOT_FOUND');
  const profile = (
    await client.query(
      `SELECT p.*,
    CASE WHEN p.birth_date IS NOT NULL THEN extract(year from age(p.birth_date))::int END AS age,
    CASE WHEN u.email_visible THEN u.email END AS email,
    CASE WHEN u.phone_visible THEN u.phone END AS phone,
    CASE WHEN u.location_visible THEN u.location ELSE p.sport_city END AS city,
    u.biography FROM player_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1`,
      [user.id]
    )
  ).rows[0];
  let shared = viewerId === user.id || profile?.is_public === true;
  if (conversationId) {
    const c = await access(client, viewerId, conversationId);
    if (c.player_user_id !== user.id) fail(404, 'PROFILE_NOT_FOUND');
    await blockCheck(client, c.player_user_id, c.club_user_id, viewerId);
    const player = (
      await client.query(
        'SELECT share_profile FROM conversation_participants WHERE conversation_id=$1 AND club_id IS NULL',
        [c.id]
      )
    ).rows[0];
    shared = shared || player.share_profile;
  } else if (viewerId !== user.id) {
    const blocked = await client.query(
      'SELECT 1 FROM user_blocks WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1)',
      [viewerId, user.id]
    );
    if (blocked.rows.length) fail(403, 'CONTACT_BLOCKED');
  }
  if (!profile || !shared)
    return {
      role: 'PLAYER',
      user: { id: user.id, username: user.username, photo_url: user.photo_url },
      shared: false,
      profile: null
    };
  const qualities = (
    await client.query(
      `SELECT s.code,s.label,s.category FROM player_sport_qualities q JOIN sport_qualities s ON s.code=q.quality_code WHERE q.user_id=$1 ORDER BY s.sort_order`,
      [user.id]
    )
  ).rows;
  // Date de naissance complète et colonnes privées ne sortent jamais de cette route.
  const allowed = [
    'first_name',
    'last_name',
    'age',
    'city',
    'positions',
    'preferred_foot',
    'height_cm',
    'current_club',
    'past_clubs',
    'experience',
    'level',
    'sport_code',
    'availability_code',
    'sport_stats',
    'sport_season',
    'biography',
    'email',
    'phone'
  ];
  return {
    role: 'PLAYER',
    user: { id: user.id, username: user.username, photo_url: user.photo_url },
    shared: true,
    profile: Object.fromEntries(allowed.map((key) => [key, profile[key]])),
    qualities
  };
}
async function ownProfile(client, userId) {
  const user = (
    await client.query('SELECT id,username,upper(role) AS role FROM users WHERE id=$1', [userId])
  ).rows[0];
  const profile =
    (await client.query('SELECT * FROM player_profiles WHERE user_id=$1', [userId])).rows[0] ||
    null;
  const qualities = (
    await client.query('SELECT quality_code FROM player_sport_qualities WHERE user_id=$1', [userId])
  ).rows.map((row) => row.quality_code);
  return { user, profile, qualities };
}
async function saveOwnProfile(client, identity, input) {
  if (identity.role !== 'PLAYER') fail(403, 'PLAYER_REQUIRED');
  const fields = [
    'sport_code',
    'availability_code',
    'sport_city',
    'sport_season',
    'sport_stats',
    'positions',
    'qualities',
    'is_public',
    'preferred_foot',
    'level',
    'current_club',
    'past_clubs',
    'experience'
  ];
  body(input, fields);
  if (!Object.keys(input).length) fail(400, 'EMPTY_UPDATE');
  const existing = (
    await client.query('SELECT * FROM player_profiles WHERE user_id=$1 FOR UPDATE', [
      identity.userId
    ])
  ).rows[0];
  if (!existing)
    fail(
      409,
      'SPORT_PROFILE_MISSING',
      'Votre fiche joueur doit être créée avant de la compléter. Vous pouvez déjà utiliser la messagerie.'
    );
  const data = {};
  for (const key of [
    'sport_city',
    'sport_season',
    'level',
    'current_club',
    'past_clubs',
    'experience'
  ])
    if (Object.hasOwn(input, key))
      data[key] = text(
        input[key],
        {
          sport_city: 100,
          sport_season: 9,
          level: 100,
          current_club: 150,
          past_clubs: 2000,
          experience: 2000
        }[key],
        true
      );
  if (data.sport_season && !/^\d{4}\/\d{4}$/.test(data.sport_season)) fail(400, 'INVALID_SEASON');
  const catalogs = { sport_code: 'sports', availability_code: 'availability_options' };
  for (const [key, table] of Object.entries(catalogs))
    if (Object.hasOwn(input, key)) {
      data[key] = text(input[key], 50, true);
      if (
        data[key] &&
        !(await client.query(`SELECT 1 FROM ${table} WHERE code=$1 AND is_active`, [data[key]]))
          .rows.length
      )
        fail(400, 'INVALID_OPTION');
    }
  if (Object.hasOwn(input, 'preferred_foot')) {
    if (input.preferred_foot !== null && !['RIGHT', 'LEFT', 'BOTH'].includes(input.preferred_foot))
      fail(400, 'INVALID_FOOT');
    data.preferred_foot = input.preferred_foot;
  }
  if (Object.hasOwn(input, 'is_public')) {
    if (typeof input.is_public !== 'boolean') fail(400, 'INVALID_FIELD');
    data.is_public = input.is_public;
  }
  if (Object.hasOwn(input, 'positions')) {
    const values = input.positions;
    if (
      !Array.isArray(values) ||
      values.length > 4 ||
      new Set(values).size !== values.length ||
      values.some((v) => typeof v !== 'string')
    )
      fail(400, 'POSITIONS_LIMIT');
    if (
      (await client.query('SELECT code FROM positions WHERE code=ANY($1::text[])', [values])).rows
        .length !== values.length
    )
      fail(400, 'INVALID_POSITION');
    data.positions = values;
  }
  if (Object.hasOwn(input, 'sport_stats')) {
    const value = input.sport_stats;
    if (
      value !== null &&
      (!value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some((k) => !['appearances', 'goals', 'assists'].includes(k)) ||
        Object.values(value).some((v) => !Number.isInteger(v) || v < 0 || v > 99999))
    )
      fail(400, 'INVALID_STATS');
    data.sport_stats = value === null ? null : JSON.stringify(value);
  }
  if (Object.hasOwn(input, 'qualities')) {
    const values = input.qualities;
    if (
      !Array.isArray(values) ||
      values.length > 20 ||
      new Set(values).size !== values.length ||
      values.some((v) => typeof v !== 'string')
    )
      fail(400, 'QUALITIES_LIMIT');
    const found = (
      await client.query('SELECT code,category FROM sport_qualities WHERE code=ANY($1::text[])', [
        values
      ])
    ).rows;
    if (
      found.length !== values.length ||
      ['TECHNICAL', 'PHYSICAL', 'TACTICAL', 'MENTAL'].some(
        (c) => found.filter((v) => v.category === c).length > 5
      )
    )
      fail(400, 'QUALITIES_LIMIT');
    await client.query('DELETE FROM player_sport_qualities WHERE user_id=$1', [identity.userId]);
    for (const value of values)
      await client.query('INSERT INTO player_sport_qualities(user_id,quality_code) VALUES($1,$2)', [
        identity.userId,
        value
      ]);
  }
  // Les anciennes fiches à plus de quatre postes ne sont jamais tronquées automatiquement.
  if (data.positions || existing.positions.length <= 4) data.sport_profile_version = 2;
  const keys = Object.keys(data);
  if (keys.length)
    await client.query(
      `UPDATE player_profiles SET ${keys.map((key, index) => `${key}=$${index + 2}`).join(',')} WHERE user_id=$1`,
      [identity.userId, ...keys.map((key) => data[key])]
    );
  return ownProfile(client, identity.userId);
}
module.exports = { clubProfile, playerProfile, ownProfile, saveOwnProfile };
