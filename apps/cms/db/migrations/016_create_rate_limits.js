/**
 * Rate limiter state.
 *
 * In the database rather than in memory because these limits are a security
 * control: a lockout that a restart clears, or that a second instance cannot
 * see, is not a lockout. The memory store is the right default for smoothing
 * ordinary traffic, and the wrong one for this.
 */

export const up = async (db) => {
  // BIGINT, not INTEGER: these columns hold `Date.now()`, and a millisecond
  // epoch passed 2^31 in 2001. SQLite's INTEGER is 64-bit so it never noticed;
  // Postgres refused the first write with "value out of range for type
  // integer", which failed every login and registration behind the limiter.
  // BIGINT reads as INTEGER affinity on SQLite, so one spelling serves both.
  await db.exec(`
    CREATE TABLE rate_limits (
      key TEXT PRIMARY KEY,
      hits TEXT NOT NULL,
      blocked_until BIGINT,
      updated_at BIGINT NOT NULL
    )
  `)

  // Sweeping deletes by age, so the scan wants an index.
  await db.exec('CREATE INDEX idx_rate_limits_updated ON rate_limits (updated_at)')
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('rate_limits'))
}
