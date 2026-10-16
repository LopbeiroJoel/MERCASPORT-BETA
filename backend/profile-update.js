const { validateRegistration, playerPositions } = require('./registration/validation');

const accountColumns = 'id, username, email, photo_url, biography, phone, location, email_visible, phone_visible, location_visible';
const commonFields = ['username', 'photo_url', 'biography', 'phone', 'location', 'email_visible', 'phone_visible', 'location_visible'];
const playerFields = ['positions', 'preferred_foot', 'current_club', 'past_clubs', 'experience', 'level'];

function reject(status, code, field, message) {
  throw Object.assign(new Error(code), { status, code, field, message: message || code });
}

function createProfileUpdate(pool, sessions) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let client;
    try {
      if (!sessions) reject(503, 'AUTH_NOT_CONFIGURED');
      if (!sessions.allowsOrigin(req)) reject(403, 'ORIGIN_DENIED');
      const identity = await sessions.authenticate(req);
      if (!identity) reject(401, 'AUTH_REQUIRED');
      if (!['PLAYER', 'CLUB'].includes(identity.role)) reject(403, 'ROLE_DENIED');
      if (!req.is('application/json')) reject(415, 'JSON_REQUIRED');
      const input = req.body;
      if (!input || typeof input !== 'object' || Array.isArray(input)) reject(400, 'INVALID_BODY');
      if (!Object.keys(input).length) reject(400, 'EMPTY_UPDATE');
      if (Object.keys(input).some(field => ![...commonFields, 'profile'].includes(field))) reject(400, 'UNKNOWN_FIELDS');

      const account = {};
      for (const field of commonFields) {
        if (!Object.hasOwn(input, field)) continue;
        const value = input[field];
        if (field === 'username') {
          const { errors, data } = validateRegistration({ username: value });
          if (errors.username) reject(400, 'INVALID_FIELD', field, errors.username);
          account[field] = data.username;
        } else if (field.endsWith('_visible')) {
          if (typeof value !== 'boolean') reject(400, 'INVALID_FIELD', field, 'Choisir oui ou non.');
          account[field] = value;
        } else {
          const limit = { photo_url: 2000, biography: 2000, phone: 30, location: 100 }[field];
          if (typeof value !== 'string' || value.length > limit || value.includes('\u0000')) {
            reject(400, 'INVALID_FIELD', field, `Saisir un texte de ${limit} caractères maximum.`);
          }
          account[field] = value;
        }
      }
      if (account.photo_url) {
        const value = account.photo_url.trim();
        if (/^\/(?!\/)/.test(value) && !/[\\\s\u0000-\u001f]/.test(value)) account.photo_url = value;
        else {
          let url;
          try { url = new URL(value); } catch { reject(400, 'INVALID_FIELD', 'photo_url', 'Utiliser une adresse HTTPS valide.'); }
          if (url.protocol !== 'https:' || url.username || url.password) reject(400, 'INVALID_FIELD', 'photo_url', 'Utiliser une adresse HTTPS valide.');
          account.photo_url = url.href;
        }
      }

      const profile = {};
      if (Object.hasOwn(input, 'profile')) {
        const value = input.profile;
        if (identity.role !== 'PLAYER') reject(403, 'ROLE_DENIED');
        if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) reject(400, 'INVALID_BODY');
        if (Object.keys(value).some(field => !playerFields.includes(field))) reject(400, 'UNKNOWN_FIELDS');
        for (const field of playerFields) {
          if (!Object.hasOwn(value, field)) continue;
          const item = value[field];
          if (field === 'positions') {
            const positions = item ?? [];
            if (!Array.isArray(positions) || positions.length > 14 || new Set(positions).size !== positions.length ||
                positions.some(code => !playerPositions.includes(code))) {
              reject(400, 'INVALID_FIELD', 'profile.positions', 'Choisir au plus 14 postes valides, sans doublon.');
            }
            profile[field] = positions;
          } else if (field === 'preferred_foot') {
            if (item !== null && !['RIGHT', 'LEFT', 'BOTH'].includes(item)) reject(400, 'INVALID_FIELD', 'profile.' + field, 'Choisir Droit, Gauche ou Les deux.');
            profile[field] = item;
          } else {
            const limit = { current_club: 150, past_clubs: 2000, experience: 2000, level: 100 }[field];
            if (item !== null && (typeof item !== 'string' || item.length > limit || item.includes('\u0000'))) {
              reject(400, 'INVALID_FIELD', 'profile.' + field, `Saisir un texte de ${limit} caractères maximum.`);
            }
            profile[field] = typeof item === 'string' ? item.trim() || null : item;
          }
        }
      }

      client = await pool.connect();
      await client.query('BEGIN');
      const owner = await client.query(`SELECT id FROM public.users WHERE id=$1
        AND upper(role)=$2 AND status NOT IN ('BANNED','DISABLED') FOR UPDATE`, [identity.userId, identity.role]);
      if (!owner.rows.length) reject(401, 'AUTH_REQUIRED');
      if (Object.keys(profile).length) {
        const sheet = await client.query('SELECT user_id FROM public.player_profiles WHERE user_id=$1 FOR UPDATE', [identity.userId]);
        if (!sheet.rows.length) reject(404, 'PROFILE_NOT_FOUND');
        if (profile.positions) {
          const positions = await client.query('SELECT code FROM public.positions WHERE code=ANY($1::text[]) FOR SHARE', [profile.positions]);
          if (positions.rows.length !== profile.positions.length) reject(400, 'INVALID_FIELD', 'profile.positions', 'Un poste est absent du catalogue.');
        }
      }
      async function update(table, key, data) {
        const names = Object.keys(data);
        if (!names.length) return;
        await client.query(`UPDATE public.${table} SET ${names.map((name, index) => `${name}=$${index + 1}`).join(', ')}
          WHERE ${key}=$${names.length + 1}`, [...Object.values(data), identity.userId]);
      }
      await update('users', 'id', account);
      await update('player_profiles', 'user_id', profile);
      const saved = (await client.query(`SELECT ${accountColumns} FROM public.users WHERE id=$1`, [identity.userId])).rows[0];
      const table = identity.role === 'PLAYER' ? 'player_profiles' : 'club_profiles';
      const profileColumns = identity.role === 'PLAYER'
        ? 'first_name, last_name, birth_date, positions, preferred_foot, height_cm, current_club, past_clubs, experience, level'
        : 'name, city, divisions, description, general_info';
      const sheet = (await client.query(`SELECT ${profileColumns} FROM public.${table} WHERE user_id=$1`, [identity.userId])).rows[0] || null;
      await client.query('COMMIT');
      res.json({ message: 'Profil enregistré.', user: { ...saved, role: identity.role }, profile: sheet });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return res.status(409).json({ code: 'USERNAME_TAKEN', field: 'username', message: 'Ce pseudo est déjà utilisé.' });
      if (error.status) return res.status(error.status).json({ code: error.code,
        ...(error.field ? { field: error.field, message: error.message } : {}) });
      res.status(503).json({ code: 'PROFILE_UNAVAILABLE' });
    } finally {
      if (client) client.release();
    }
  };
}

module.exports = { createProfileUpdate };
