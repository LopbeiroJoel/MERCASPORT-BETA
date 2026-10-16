// REPERE ORAL - EVITER LES INSCRIPTIONS EN BOUCLE.
// Le compteur est dans PostgreSQL, donc plusieurs instances voient les memes tentatives.
// Je stocke une empreinte de l'adresse, pas l'adresse en clair dans cette table.
// Un SHA-256 n'est pas une promesse d'anonymat : une adresse connue peut etre rehashée.

const { createHash } = require('node:crypto');
const { isIP } = require('node:net');

// Compteurs PostgreSQL partages entre toutes les instances du serveur.
// Vercel fournit cet en-tete ; hors Vercel, ignorer les en-tetes du client.
// Reference : https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
function clientAddress(req) {
  const forwarded = process.env.VERCEL === '1' ? req.get('x-vercel-forwarded-for') : null;
  const address = forwarded?.split(',')[0].trim() || req.socket.remoteAddress;
  return isIP(address || '') ? address : 'unknown';
}

function createRegistrationLimiter(pool) {
  return async req => {
    const key = createHash('sha256').update(`registration:${clientAddress(req)}`).digest('hex');
    await pool.query(`DELETE FROM public.registration_rate_limits WHERE key_hash IN
      (SELECT key_hash FROM public.registration_rate_limits
       WHERE expires_at <= CURRENT_TIMESTAMP LIMIT 100)`);
    const { rows } = await pool.query(`INSERT INTO public.registration_rate_limits
      (key_hash, attempts, expires_at) VALUES ($1, 1, CURRENT_TIMESTAMP + INTERVAL '15 minutes')
      ON CONFLICT (key_hash) DO UPDATE SET
        attempts = CASE WHEN registration_rate_limits.expires_at <= CURRENT_TIMESTAMP
          THEN 1 ELSE registration_rate_limits.attempts + 1 END,
        expires_at = CASE WHEN registration_rate_limits.expires_at <= CURRENT_TIMESTAMP
          THEN EXCLUDED.expires_at ELSE registration_rate_limits.expires_at END
      WHERE registration_rate_limits.expires_at <= CURRENT_TIMESTAMP
        OR registration_rate_limits.attempts < 10
      RETURNING attempts`, [key]);
    return rows.length === 1;
  };
}

module.exports = { createRegistrationLimiter, clientAddress };
