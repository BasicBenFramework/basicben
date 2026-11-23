/**
 * Heartbeats for background jobs: "this ran, at this time, and found this".
 *
 * Read by the site health page; written by scheduled publishing, the
 * analytics purge and `scripts/backup.mjs`. See migration 037 for why this is
 * a table of its own.
 *
 * Imports nothing and takes the database handle as an argument, for the same
 * reason as `export-data.ts`: the backup script is plain Node, which cannot
 * resolve the extensionless imports the rest of `src/` uses.
 *
 * Recording is best-effort everywhere it is called. A heartbeat is a report
 * about a job, and a job must never fail because its report could not be
 * written — on a database that has not run migration 037 yet, for one.
 */

export interface HeartbeatDb {
  driver?: string
  get: (sql: string, params?: unknown[]) => unknown
  all: (sql: string, params?: unknown[]) => unknown
  run: (sql: string, params?: unknown[]) => unknown
}

export interface Heartbeat {
  name: string
  last_run_at: string
  detail: Record<string, unknown> | null
}

/** The jobs that report in. Named so the health page can say which never has. */
export const HEARTBEATS = {
  PUBLISH_DUE: 'publish_due',
  BACKUP: 'backup'
} as const

/** Upsert the job's row. Never throws. */
export async function recordHeartbeat(
  db: HeartbeatDb,
  name: string,
  detail: Record<string, unknown> = {},
  now: Date = new Date()
): Promise<void> {
  try {
    const at = now.toISOString()
    const json = JSON.stringify(detail).slice(0, 1000)

    await db.run(
      `INSERT INTO ops_heartbeats (name, last_run_at, detail) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at, detail = excluded.detail`,
      [name, at, json]
    )
  } catch {
    // See the file comment: best-effort by design.
  }
}

/** Every recorded heartbeat, keyed by name. Empty if the table is missing. */
export async function readHeartbeats(db: HeartbeatDb): Promise<Record<string, Heartbeat>> {
  try {
    const rows = (await db.all('SELECT name, last_run_at, detail FROM ops_heartbeats')) as Array<{
      name: string
      last_run_at: unknown
      detail: string | null
    }>

    const out: Record<string, Heartbeat> = {}

    for (const row of rows) {
      let detail: Record<string, unknown> | null = null
      try {
        detail = row.detail ? JSON.parse(row.detail) : null
      } catch {
        detail = null
      }

      // Postgres hands a TIMESTAMP back as a Date; SQLite as the text written.
      const at = row.last_run_at instanceof Date ? row.last_run_at.toISOString() : String(row.last_run_at)
      out[row.name] = { name: row.name, last_run_at: at, detail }
    }

    return out
  } catch {
    return {}
  }
}
