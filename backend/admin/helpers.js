// Petites fonctions communes. Aucun nom de table ne vient du formulaire.
function fail(status, code, fields) {
  const error = new Error(code);
  Object.assign(error, { status, code, fields });
  throw error;
}

function id(value) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) fail(400, 'INVALID_ID');
  return Number(value);
}

function body(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) {
    fail(400, 'INVALID_BODY');
  }
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(400, 'UNKNOWN_FIELDS');
  if (required.some(key => !Object.hasOwn(value, key))) fail(400, 'MISSING_FIELDS');
  return value;
}

function text(value, max, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
      (required && !value.trim())) fail(400, 'INVALID_TEXT');
  return value.trim().normalize('NFC') || null;
}

// Une transaction pour toutes les écritures : revérification des droits puis COMMIT ou ROLLBACK.
async function transaction(pool, adminId, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const permission = await client.query(`SELECT p.user_id FROM public.admin_permissions p
      JOIN public.users u ON u.id = p.user_id
      WHERE p.user_id = $1 AND p.role = 'ADMIN' AND p.is_active = TRUE AND u.status = 'ACTIVE'
      FOR SHARE OF p, u`, [adminId]);
    if (!permission.rows.length) fail(403, 'ADMIN_ACCESS_DENIED');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// table, key et columns sont des constantes du code, jamais des valeurs du client.
async function update(client, table, key, value, data, columns = '*') {
  const names = Object.keys(data);
  if (!names.length) fail(400, 'EMPTY_UPDATE');
  const values = names.map(name => data[name]);
  values.push(value);
  const result = await client.query(`UPDATE public.${table}
    SET ${names.map((name, i) => `${name} = $${i + 1}`).join(', ')}
    WHERE ${key} = $${values.length} RETURNING ${columns}`, values);
  if (!result.rows.length) fail(404, 'NOT_FOUND');
  return result.rows[0];
}

async function insert(client, table, data, columns = '*') {
  const names = Object.keys(data);
  const result = await client.query(`INSERT INTO public.${table} (${names.join(', ')})
    VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${columns}`, Object.values(data));
  return result.rows[0];
}

async function checkPositions(client, positions) {
  const result = await client.query('SELECT code FROM public.positions WHERE code = ANY($1::text[]) FOR SHARE', [positions]);
  if (result.rows.length !== positions.length) fail(400, 'INVALID_POSITIONS');
}

module.exports = { fail, id, body, text, transaction, update, insert, checkPositions };
