const rateLimit = require('express-rate-limit');

class PostgresStore {
  constructor(pool) {
    this.pool = pool;
    this.windowMs = 0;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const now = new Date();
    const existing = await this.pool.query('SELECT count, reset_at FROM rate_limits WHERE key = $1', [key]);

    if (existing.rows.length === 0 || new Date(existing.rows[0].reset_at) <= now) {
      const resetTime = new Date(now.getTime() + this.windowMs);
      await this.pool.query(
        `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, $2)
         ON CONFLICT (key) DO UPDATE SET count = 1, reset_at = $2`,
        [key, resetTime]
      );
      return { totalHits: 1, resetTime };
    }

    const updated = await this.pool.query(
      'UPDATE rate_limits SET count = count + 1 WHERE key = $1 RETURNING count, reset_at',
      [key]
    );
    return { totalHits: updated.rows[0].count, resetTime: new Date(updated.rows[0].reset_at) };
  }

  async decrement(key) {
    await this.pool.query('UPDATE rate_limits SET count = GREATEST(count - 1, 0) WHERE key = $1', [key]);
  }

  async resetKey(key) {
    await this.pool.query('DELETE FROM rate_limits WHERE key = $1', [key]);
  }
}

function createLoginLimiter(pool) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    // Only failed attempts count. Without this, a handful of legitimate
    // logins from a shared office IP (this is an internal ~20-person tool,
    // manual account provisioning, likely one NAT'd egress IP) could burn
    // through the budget and lock out the whole office for 15 minutes.
    skipSuccessfulRequests: true,
    store: new PostgresStore(pool),
    message: { error: 'too many login attempts, try again later' }
  });
}

module.exports = { createLoginLimiter, PostgresStore };
