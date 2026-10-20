const { fail, id, body, text, manages, audit } = require('../messaging/core');

const { validatePlayerAd } = require('./player-ad');

const catalogs = {
  sports: 'sports',
  availability: 'availability_options',
  mobility: 'mobility_options',
  categories: 'sport_categories',
  project_types: 'project_types',
  recruitment_types: 'recruitment_types',
  conditions: 'recruitment_conditions',
  announcement_statuses: 'announcement_statuses',
  application_statuses: 'application_statuses',
  report_reasons: 'report_reasons'
};
async function options(client) {
  const result = {};
  for (const [key, table] of Object.entries(catalogs))
    result[key] = (
      await client.query(
        `SELECT code,label FROM ${table} WHERE is_active ORDER BY sort_order,code`
      )
    ).rows;
  result.positions = (
    await client.query('SELECT code,label FROM positions ORDER BY sort_order')
  ).rows;
  result.divisions = (
    await client.query('SELECT code FROM divisions ORDER BY sort_order')
  ).rows.map((row) => ({ ...row, label: row.code }));
  result.qualities = (
    await client.query('SELECT code,label,category FROM sport_qualities ORDER BY sort_order')
  ).rows;
  result.feet = (
    await client.query('SELECT code,label FROM preferred_feet ORDER BY sort_order')
  ).rows;
  return result;
}
const columns = `a.id,a.author_id,a.club_id,a.title,a.description,a.city,a.announcement_type,a.sport_code,a.availability_code,a.mobility_code,a.category_code,a.recruitment_type_code,a.primary_position,coalesce(a.division_code,(SELECT t.division FROM teams t WHERE t.id=a.team_id)) AS division_code,a.preferred_foot,a.created_at,a.updated_at,a.expires_at,a.player_details,a.short_description,a.location,a.contract,a.work_time,a.salary,a.requirements,a.missions,a.additional_info,
 CASE WHEN a.status='PUBLISHED' AND a.expires_at<=now() THEN 'EXPIRED' ELSE a.status END AS status,
 coalesce(c.name,u.username) AS author_name,u.photo_url AS avatar,
 ARRAY(SELECT position_code FROM ad_positions WHERE ad_id=a.id ORDER BY position_code=a.primary_position DESC,position_code) AS positions,
 ARRAY(SELECT quality_code FROM ad_qualities WHERE ad_id=a.id ORDER BY quality_code) AS qualities,
 ARRAY(SELECT project_code FROM ad_project_types WHERE ad_id=a.id ORDER BY project_code) AS project_types,
 ARRAY(SELECT condition_code FROM ad_conditions WHERE ad_id=a.id ORDER BY condition_code) AS conditions`;
async function list(client, query, identity) {
  const owned = query.owned === '1';
  if (owned && !identity) fail(401, 'AUTH_REQUIRED');
  if (query.type && !['PLAYER_SEARCH', 'CLUB_SEARCH'].includes(query.type))
    fail(400, 'INVALID_TYPE');
  const type = owned
    ? query.type || null
    : identity?.role === 'CLUB'
      ? 'PLAYER_SEARCH'
      : 'CLUB_SEARCH';
  const before = query.before ? id(query.before) : 2147483647;
  const rows = (
    await client.query(
      `SELECT ${columns},(SELECT count(*)::int FROM applications ap WHERE ap.ad_id=a.id AND ap.player_user_id IS NOT NULL) AS application_count
 FROM ads a LEFT JOIN clubs c ON c.id=a.club_id LEFT JOIN users u ON u.id=a.author_id
 WHERE a.id<$1 AND ($2::boolean OR (a.status='PUBLISHED' AND (a.expires_at IS NULL OR a.expires_at>now()) AND coalesce(u.status,'ACTIVE') NOT IN ('BANNED','DISABLED')))
 AND (NOT $2::boolean OR a.author_id=$3 OR messaging_manages_club($3,a.club_id))
 AND ($4::text IS NULL OR a.announcement_type=$4) AND ($5::text IS NULL OR a.sport_code=$5)
 AND ($6::text IS NULL OR EXISTS(SELECT 1 FROM ad_positions p WHERE p.ad_id=a.id AND p.position_code=$6))
 AND ($7::text IS NULL OR coalesce(a.division_code,(SELECT t.division FROM teams t WHERE t.id=a.team_id))=$7) AND ($8::text IS NULL OR a.city ILIKE '%'||$8||'%')
 AND ($9::text IS NULL OR a.availability_code=$9)
 ORDER BY a.id DESC LIMIT 31`,
      [
        before,
        owned,
        identity?.userId || null,
        type,
        query.sport || null,
        query.position || null,
        query.level || null,
        query.city ? text(query.city, 100) : null,
        query.availability || null
      ]
    )
  ).rows;
  // Le nombre de candidatures est réservé au propriétaire/représentant.
  if (!owned) for (const row of rows) delete row.application_count;
  return {
    items: rows.slice(0, 30),
    next: rows.length > 30 ? rows[29].id : null
  };
}
async function detail(client, adId, identity) {
  const row = (
    await client.query(
      `SELECT ${columns},a.recruitment_version FROM ads a LEFT JOIN clubs c ON c.id=a.club_id LEFT JOIN users u ON u.id=a.author_id
 WHERE a.id=$1 AND ((a.status='PUBLISHED' AND (a.expires_at IS NULL OR a.expires_at>now()) AND coalesce(u.status,'ACTIVE') NOT IN ('BANNED','DISABLED')) OR a.author_id=$2 OR messaging_manages_club($2,a.club_id))`,
      [id(adId), identity?.userId || null]
    )
  ).rows[0];
  if (!row) fail(404, 'AD_NOT_FOUND');
  return row;
}
const fields = [
  'announcement_type',
  'club_id',
  'title',
  'description',
  'city',
  'sport_code',
  'availability_code',
  'mobility_code',
  'category_code',
  'recruitment_type_code',
  'division_code',
  'preferred_foot_code',
  'positions',
  'primary_position',
  'qualities',
  'project_types',
  'conditions',
  'status',
  'player_details'
];
async function save(client, identity, input, adId) {
  body(input, fields);
  let old;
  if (adId) {
    old = (await client.query('SELECT * FROM ads WHERE id=$1 FOR UPDATE', [id(adId)])).rows[0];
    if (!old) fail(404, 'AD_NOT_FOUND');
    if (
      old.author_id !== identity.userId &&
      !(await manages(client, identity.userId, old.club_id))
    )
      fail(403, 'AD_OWNER_REQUIRED');
    if (old.status === 'DELETED') fail(409, 'AD_REMOVED');
  }
  const type = old?.announcement_type || input.announcement_type;
  if (
    !['PLAYER_SEARCH', 'CLUB_SEARCH'].includes(type) ||
    (old && input.announcement_type && input.announcement_type !== type)
  )
    fail(400, 'INVALID_TYPE');
  const clubId =
    type === 'CLUB_SEARCH' ? old?.club_id || (input.club_id ? id(input.club_id) : null) : null;
  if (type === 'CLUB_SEARCH' && (!clubId || !(await manages(client, identity.userId, clubId))))
    fail(403, 'CLUB_ACCESS_DENIED');
  if (old && input.club_id && id(input.club_id) !== old.club_id)
    fail(403, 'CLUB_ACCESS_DENIED');
  if (type === 'PLAYER_SEARCH' && (identity.role !== 'PLAYER' || input.club_id))
    fail(403, 'PLAYER_REQUIRED');
  const status = input.status || old?.status || 'DRAFT';
  const playerDetails =
    type === 'PLAYER_SEARCH' ? await validatePlayerAd(client, input, old, status) : null;
  if (type === 'CLUB_SEARCH' && Object.hasOwn(input, 'player_details'))
    fail(400, 'INVALID_FIELD');
  const data = {};
  for (const key of ['title', 'description', 'city'])
    if (Object.hasOwn(input, key))
      data[key] = text(input[key], { title: 150, description: 5000, city: 100 }[key], true);
  const refs = {
    sport_code: 'sports',
    availability_code: 'availability_options',
    mobility_code: 'mobility_options',
    category_code: 'sport_categories',
    recruitment_type_code: 'recruitment_types',
    division_code: 'divisions'
  };
  for (const [key, table] of Object.entries(refs))
    if (Object.hasOwn(input, key)) {
      data[key] = text(input[key], 50, true);
      if (
        data[key] &&
        !(
          await client.query(
            `SELECT 1 FROM ${table} WHERE code=$1${table === 'divisions' ? '' : ' AND is_active'}`,
            [data[key]]
          )
        ).rows.length
      )
        fail(400, 'INVALID_OPTION');
    }
  if (Object.hasOwn(input, 'preferred_foot_code')) {
    const value = text(input.preferred_foot_code, 10, true);
    const foot = value
      ? (await client.query('SELECT label FROM preferred_feet WHERE code=$1', [value])).rows[0]
      : null;
    if (value && !foot) fail(400, 'INVALID_FOOT');
    data.preferred_foot = foot?.label || null;
  }
  const arrays = {
    positions: ['positions', 'code', type === 'CLUB_SEARCH' ? 3 : null],
    qualities: ['sport_qualities', 'code', type === 'PLAYER_SEARCH' ? 20 : 5],
    project_types: ['project_types', 'code', 3],
    conditions: ['recruitment_conditions', 'code', 3]
  };
  for (const [key, [table, column, limit]] of Object.entries(arrays))
    if (Object.hasOwn(input, key)) {
      const values = input[key];
      if (
        !Array.isArray(values) ||
        (limit !== null && values.length > limit) ||
        new Set(values).size !== values.length ||
        values.some((v) => typeof v !== 'string' || v.length > 50)
      )
        fail(
          400,
          'SELECTION_LIMIT',
          `Sélection invalide : ${key}${limit === null ? '' : `, maximum ${limit}`}.`
        );
      if (
        ((key === 'project_types' && type === 'CLUB_SEARCH') ||
          (key === 'conditions' && type === 'PLAYER_SEARCH')) &&
        values.length
      )
        fail(400, 'INVALID_OPTION');
      if (
        (
          await client.query(`SELECT ${column} FROM ${table} WHERE ${column}=ANY($1::text[])`, [
            values
          ])
        ).rows.length !== values.length
      )
        fail(400, 'INVALID_OPTION');
    }

  if (Array.isArray(input.qualities)) {
    const categories = (
      await client.query(
        'SELECT category,count(*)::int AS n FROM sport_qualities WHERE code=ANY($1::text[]) GROUP BY category',
        [input.qualities]
      )
    ).rows;
    if (categories.some((row) => row.n > 5))
      throw Object.assign(new Error('Choisir au maximum 5 qualités par catégorie.'), {
        status: 400,
        code: 'VALIDATION_ERROR',
        fields: { qualities: 'Choisir au maximum 5 qualités par catégorie.' }
      });
  }
  if (!['DRAFT', 'PUBLISHED', 'SUSPENDED', 'EXPIRED', 'CLOSED', 'ARCHIVED'].includes(status))
    fail(400, 'INVALID_STATUS');
  if (!old || (!data.title && Object.hasOwn(data, 'title'))) {
    const name = clubId
      ? (await client.query('SELECT name FROM clubs WHERE id=$1', [clubId])).rows[0].name
      : (await client.query('SELECT username FROM users WHERE id=$1', [identity.userId]))
          .rows[0].username;
    data.title =
      data.title ||
      `${name}${type === 'CLUB_SEARCH' ? ' recrute' : ' recherche un club'}`.slice(0, 150);
  }
  let result;
  if (!old) {
    result = (
      await client.query(
        `INSERT INTO ads(author_id,club_id,title,description,position,city,recruitment_version,announcement_type,status,published_at,expires_at)
   VALUES($1,$2,$3,$4,'Non précisé',$5,2,$6,$7::varchar,CASE WHEN $7::varchar='PUBLISHED' THEN now() END,CASE WHEN $7::varchar='PUBLISHED' THEN now()+interval '30 days' END) RETURNING id`,
        [
          identity.userId,
          clubId,
          data.title,
          data.description || null,
          data.city || null,
          type,
          status
        ]
      )
    ).rows[0];
  } else result = { id: old.id };
  data.status = status;
  data.recruitment_version = type === 'PLAYER_SEARCH' ? 3 : 2;
  if (playerDetails) data.player_details = JSON.stringify(playerDetails);
  if (Object.hasOwn(input, 'primary_position'))
    data.primary_position = text(input.primary_position, 50, true);
  const selected =
    input.positions ||
    (
      await client.query('SELECT position_code FROM ad_positions WHERE ad_id=$1', [result.id])
    ).rows.map((r) => r.position_code);
  if (data.primary_position && !selected.includes(data.primary_position))
    fail(400, 'INVALID_PRIMARY_POSITION');
  if (Object.hasOwn(input, 'positions')) {
    data.primary_position = data.primary_position || selected[0] || null;
    data.position = selected.length
      ? (
          await client.query('SELECT label FROM positions WHERE code=$1', [
            data.primary_position
          ])
        ).rows[0].label
      : 'Non précisé';
  }
  const keys = Object.keys(data);
  await client.query(
    `UPDATE ads SET ${keys.map((key, index) => `${key}=$${index + 2}`).join(',')},short_description=left(coalesce($${keys.length + 2},description),200),updated_at=clock_timestamp(),published_at=CASE WHEN $${keys.length + 3}='PUBLISHED' THEN coalesce(published_at,now()) ELSE published_at END,expires_at=CASE WHEN $${keys.length + 3}='PUBLISHED' THEN coalesce(expires_at,now()+interval '30 days') ELSE expires_at END WHERE id=$1`,
    [result.id, ...keys.map((k) => data[k]), data.description || null, status]
  );
  const links = {
    positions: ['ad_positions', 'position_code'],
    qualities: ['ad_qualities', 'quality_code'],
    project_types: ['ad_project_types', 'project_code'],
    conditions: ['ad_conditions', 'condition_code']
  };
  for (const [key, [table, column]] of Object.entries(links))
    if (Object.hasOwn(input, key)) {
      await client.query(`DELETE FROM ${table} WHERE ad_id=$1`, [result.id]);
      for (const value of input[key])
        await client.query(`INSERT INTO ${table}(ad_id,${column}) VALUES($1,$2)`, [
          result.id,
          value
        ]);
    }
  await audit(client, identity.userId, old ? 'UPDATE_AD' : 'CREATE_AD', 'ad', result.id);
  return detail(client, result.id, identity);
}
async function renew(client, identity, adId) {
  const ad = (await client.query('SELECT * FROM ads WHERE id=$1 FOR UPDATE', [id(adId)]))
    .rows[0];
  if (!ad) fail(404, 'AD_NOT_FOUND');
  if (ad.author_id !== identity.userId && !(await manages(client, identity.userId, ad.club_id)))
    fail(403, 'AD_OWNER_REQUIRED');
  if (ad.status === 'DELETED') fail(409, 'AD_REMOVED');
  if (ad.announcement_type === 'PLAYER_SEARCH')
    await validatePlayerAd(client, {}, ad, 'PUBLISHED');
  await client.query(
    "UPDATE ads SET status='PUBLISHED',published_at=now(),expires_at=now()+interval '30 days',updated_at=clock_timestamp() WHERE id=$1",
    [ad.id]
  );
  await audit(client, identity.userId, 'RENEW_AD', 'ad', ad.id);
  return detail(client, ad.id, identity);
}
module.exports = { options, list, detail, save, renew };
