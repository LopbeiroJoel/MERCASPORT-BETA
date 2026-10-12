// PostgreSQL counters shared by all instances. No email or IP is stored in clear.
function createSqlRateLimiter(pool, digest, { maxAttempts = 10, windowMs = 900000 } = {}) {
  if (typeof digest !== 'function' || !Number.isInteger(maxAttempts) || maxAttempts < 1 ||
      !Number.isInteger(windowMs) || windowMs < 1 || windowMs > 86400000) throw new Error('Invalid rate limiter');
  let lastCleanup = 0;
  return {
    retryAfter: Math.ceil(windowMs / 1000),
    async allow(value) {
      if (Date.now() - lastCleanup > 30000) {
        lastCleanup = Date.now();
        await pool.query(`DELETE FROM auth_rate_limits WHERE key_hash IN
          (SELECT key_hash FROM auth_rate_limits WHERE expires_at <= CURRENT_TIMESTAMP LIMIT 100)`);
      }
      const { rows } = await pool.query(`INSERT INTO auth_rate_limits(key_hash,attempts,expires_at)
        VALUES ($1,1,CURRENT_TIMESTAMP + ($2 * INTERVAL '1 millisecond'))
        ON CONFLICT(key_hash) DO UPDATE SET
          attempts=CASE WHEN auth_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE auth_rate_limits.attempts+1 END,
          expires_at=CASE WHEN auth_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN EXCLUDED.expires_at ELSE auth_rate_limits.expires_at END
        WHERE auth_rate_limits.expires_at <= CURRENT_TIMESTAMP OR auth_rate_limits.attempts < $3
        RETURNING attempts`, [digest(value), windowMs, maxAttempts]);
      return rows.length === 1;
    },
  };
}
module.exports = { createSqlRateLimiter };
