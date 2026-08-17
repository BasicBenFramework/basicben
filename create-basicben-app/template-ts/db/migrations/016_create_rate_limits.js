/**
 * Rate limiter state.
 *
 * In the database rather than in memory because these limits are a security
 * control: a lockout that a restart clears, or that a second instance cannot
 * see, is not a lockout. The memory store is the right default for smoothing
 * ordinary traffic, and the wrong one for this.
 */

export const up = async (db) => {
  await db.exec(`
    CREATE TABLE rate_limits (
      key TEXT PRIMARY KEY,
      hits TEXT NOT NULL,
      blocked_until INTEGER,
      updated_at INTEGER NOT NULL
    )
  `)

  // Sweeping deletes by age, so the scan wants an index.
  await db.exec('CREATE INDEX idx_rate_limits_updated ON rate_limits (updated_at)')
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS rate_limits')
}
