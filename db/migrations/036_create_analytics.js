/**
 * Privacy-friendly analytics: daily counts, and nothing that identifies anyone.
 *
 * The model is documented in docs/analytics.md. In short, what is kept long
 * term is only ever a count per day — views and unique visitors per path, for
 * the site as a whole, and views per referring domain. There is no table of
 * hits, so there is nothing to join a visitor's pages back together with, and
 * no column anywhere holds an address, a user agent or a cookie value.
 *
 * Counting *unique* visitors needs some memory within a day, and that is the
 * job of the two short-lived tables:
 *
 * - `analytics_salts` holds one random salt per UTC day. A visitor is the hash
 *   of (salt, address, user agent), so the same browser on the same day hashes
 *   the same and is counted once. The salt is deleted once its day is over, and
 *   with it any way to recompute a hash — the address space is small enough to
 *   brute-force a hash whose salt is known, so the salt must not outlive the
 *   day. It is random and stored, rather than derived from APP_KEY alone,
 *   because a derived salt can always be derived again.
 * - `analytics_seen` holds those hashes, one opaque row each, so a second
 *   instance (serverless) sees what the first already counted. Per-path rows
 *   hash the path in as well, so rows cannot be grouped into one visitor's
 *   trail even while they exist. Rows are deleted after the configured window
 *   (`analytics_dedup_hours`, at most 24) and in any case once their UTC day,
 *   and with it their salt, is over.
 *
 * `created_at` on `analytics_seen` is a millisecond epoch, BIGINT for the same
 * reason as `rate_limits`: Postgres INTEGER is 32-bit.
 *
 * Days are `YYYY-MM-DD` text in UTC on every driver, so ranges compare as
 * strings and no dialect's date functions are involved.
 */

export const up = async (db, grammar) => {
  // Whole-site totals. Visitors here are unique across the site, which a sum
  // of the per-path rows would overcount.
  await db.exec(`
    CREATE TABLE analytics_totals (
      day TEXT PRIMARY KEY,
      views INTEGER NOT NULL DEFAULT 0,
      visitors INTEGER NOT NULL DEFAULT 0
    )
  `)

  await db.exec(`
    CREATE TABLE analytics_daily (
      day TEXT NOT NULL,
      path TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      visitors INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, path)
    )
  `)

  // Domain only — never the full referring URL, which can carry a search
  // query, a session id or someone's private document link.
  await db.exec(`
    CREATE TABLE analytics_referrers (
      day TEXT NOT NULL,
      domain TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, domain)
    )
  `)

  await db.exec(`
    CREATE TABLE analytics_seen (
      hash TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `)
  // The purge deletes by age.
  await db.exec('CREATE INDEX idx_analytics_seen_created ON analytics_seen (created_at)')

  await db.exec(`
    CREATE TABLE analytics_salts (
      day TEXT PRIMARY KEY,
      salt TEXT NOT NULL,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export const down = async (db, grammar) => {
  for (const table of ['analytics_salts', 'analytics_seen', 'analytics_referrers', 'analytics_daily', 'analytics_totals']) {
    await db.exec(grammar.dropTable(table))
  }
}
