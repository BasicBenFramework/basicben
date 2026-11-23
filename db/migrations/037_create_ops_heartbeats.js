/**
 * Heartbeats: when each background job last ran, and what it reported.
 *
 * The site health page needs to say "scheduled posts were last checked four
 * minutes ago" and "the last backup was nine days ago". Both jobs run somewhere
 * the page cannot see — another serverless instance, a cron box, an operator's
 * laptop — so an in-memory timestamp only ever describes the instance that
 * happened to answer. A row per job is the smallest shared memory that works.
 *
 * Deliberately not the settings table: settings are what an admin chooses and
 * are exported with the site; this is per-database state that means nothing
 * anywhere else, and it must not become writable through `PUT /api/settings`.
 *
 * `detail` is a short JSON summary (a count, a file name) — never anything
 * secret, since the health page shows it.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE ops_heartbeats (
      name TEXT PRIMARY KEY,
      last_run_at ${grammar.timestampType()} NOT NULL,
      detail TEXT
    )
  `)
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('ops_heartbeats'))
}
