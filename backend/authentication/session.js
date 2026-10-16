// REPERE ORAL - LE COOKIE ET LA SESSION (doc, sections 10 et 21).
// Le JWT est SIGNE, pas chiffre : je ne mets donc pas de mot de passe lisible dedans.
// Je controle aussi auth_sessions en SQL : ce n'est pas un JWT accepte sans verifier la base.
// Duree par defaut : 1800 secondes = 30 minutes. Pas de refresh token ni de prolongation automatique.
// Recharger la page ou appeler /auth/me ne repousse pas la date d'expiration.

const { randomUUID, createHmac, timingSafeEqual } = require('node:crypto');
const COOKIE = '__Host-mercasport_session';
const LOCAL_COOKIE = 'mercasport_session';

function createSessionService(pool, { secret, origins, lifetimeSeconds = 1800, allowLocalHttp = false } = {}) {
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error('AUTH_SECRET must be 32 random bytes encoded as 64 hexadecimal characters.');
  }
  if (!Array.isArray(origins) || !origins.length || origins.some(value => {
    try {
      const u = new URL(value);
      const local = allowLocalHttp && !process.env.VERCEL && process.env.NODE_ENV !== 'production' && u.protocol === 'http:'
        && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
      return (u.protocol !== 'https:' && !local) || u.origin !== value;
    }
    catch { return true; }
  })) throw new Error('Configure exact HTTPS origins.');
  const localHttp = origins.every(value => value.startsWith('http:'));
  if (origins.some(value => value.startsWith('http:')) && !localHttp) {
    throw new Error('Do not mix HTTP and HTTPS origins.');
  }
  // HTTP est autorise uniquement pour le developpement sur le PC.
  const cookieName = localHttp ? LOCAL_COOKIE : COOKIE;
  // HttpOnly : JS ne lit pas le cookie. Secure : HTTPS en production. SameSite strict limite les envois entre sites.
  const cookieOptions = { httpOnly: true, secure: !localHttp, sameSite: 'strict', path: '/' };
  if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 60 || lifetimeSeconds > 3600) {
    throw new Error('Session lifetime must be 60..3600 seconds.');
  }
  const key = Buffer.from(secret, 'hex');
  const tag = hash => createHmac('sha256', key).update(hash).digest('base64url');
  // Je compare l'origine complete a la configuration. Ce controle ne remplace pas l'authentification.
  const allowsOrigin = req => origins.includes(req.headers.origin);
  // Lire un token ne suffit pas : jwtVerify va verifier la signature, l'expiration et les champs attendus.
  async function readPayload(req) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !allowsOrigin(req)) return null;
    const matches = String(req.headers.cookie || '').split(';').map(v => v.trim())
      .filter(v => v.startsWith(`${cookieName}=`));
    if (matches.length !== 1) return null;
    // credential est une empreinte HMAC du hash, pas le mot de passe. Le JWT est lisible mais sa signature est controlee.
    const token = matches[0].slice(cookieName.length + 1);
    if (token.length > 2048) return null;
    try {
      const { jwtVerify } = await import('jose');
      // sub = ID utilisateur ; jti = ID de session ; iat/exp = dates ; issuer/audience = usage prevu.
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'],
        issuer: 'mercasport-auth', audience: 'mercasport-api', typ: 'JWT',
        requiredClaims: ['sub', 'iat', 'exp', 'jti', 'credential'], maxTokenAge: lifetimeSeconds });
      if (!/^[1-9]\d{0,9}$/.test(payload.sub) || Number(payload.sub) > 2147483647 ||
          typeof payload.credential !== 'string' || typeof payload.jti !== 'string' ||
          !/^[a-f0-9-]{36}$/.test(payload.jti)) return null;
      return payload;
    } catch { return null; }
  }
  return {
    allowsOrigin,
    rateKey: value => createHmac('sha256', key).update(`rate:${value}`).digest('hex'),
    // ISSUE = emettre une nouvelle session apres connexion, pas rafraichir une session a chaque page.
    async issue(user, res) {
      const { SignJWT } = await import('jose');
      const id = randomUUID();
      const issued = Math.floor(Date.now() / 1000), expires = issued + lifetimeSeconds;
      const token = await new SignJWT({ credential: tag(user.password_hash) })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(String(user.id))
        .setIssuer('mercasport-auth').setAudience('mercasport-api')
        .setIssuedAt(issued).setJti(id).setExpirationTime(expires).sign(key);
      await pool.query(`INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,to_timestamp($3))`,
        [id, user.id, expires]);
      res.cookie(cookieName, token, { ...cookieOptions, maxAge: lifetimeSeconds * 1000 });
    },
    // AUTHENTICATE = verifier : token valide + session SQL encore active + compte non bloque.
    // Je reprends le role actuel en base : le navigateur ne decide pas de ses droits.
    async authenticate(req) {
      const payload = await readPayload(req);
      if (!payload) return null;
      const { rows } = await pool.query(`SELECT u.id,u.password_hash,u.role,u.status,u.is_verified
        FROM users u JOIN auth_sessions s ON s.user_id=u.id
        WHERE u.id=$1 AND s.id=$2 AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP`,
        [Number(payload.sub), payload.jti]);
      if (!rows.length) return null;
      // Si le hash du mot de passe a change, l'empreinte attendue change : l'ancien cookie est refuse.
      const expected = Buffer.from(tag(rows[0].password_hash));
      const actual = Buffer.from(payload.credential);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      const { id, role, status, is_verified } = rows[0];
      // Refuser aussi les sessions deja ouvertes avant la sanction.
      if (['BANNED', 'DISABLED'].includes(status)) return null;
      return { userId: id, role: role.toUpperCase(), status, is_verified };
    },
    // REVOKE = mettre revoked_at en SQL. L'ancienne copie du token ne passe alors plus authenticate.
    async revoke(req) {
      const payload = await readPayload(req);
      if (payload) await pool.query(`UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP
        WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`, [payload.jti, Number(payload.sub)]);
    },
    // Effacer le cookie et revoquer la session sont deux actions complementaires du logout.
    clear(res) { res.clearCookie(cookieName, cookieOptions); },
  };
}
module.exports = { createSessionService, COOKIE };
