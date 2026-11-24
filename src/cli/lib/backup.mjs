/**
 * The moving parts of `basicben-cms backup` and `basicben-cms restore`, kept
 * apart from the CLI so the tests can drive them against an in-memory
 * database and a fake bucket.
 *
 * ## What a backup is
 *
 * The JSON export (`src/helpers/export-data.ts`), revisions included: every
 * table that is content, with every credential left out. It is portable —
 * restore it into SQLite, Turso or Postgres — and it is safe to hand to a
 * storage provider, because there is nothing in it that signs anyone in.
 *
 * Optionally, on SQLite, a consistent copy of the database file made with
 * `VACUUM INTO`, which keeps ids, analytics counts and everything else the
 * export does not cover. That copy is **scrubbed** before it is written out:
 * the same secrets the export omits are deleted from it, and then the copy is
 * vacuumed again, because SQLite leaves deleted rows readable in free pages
 * until it is.
 *
 * Both contain personal data — account and commenter email addresses — so
 * both are treated as sensitive: random file names, never a public bucket
 * by default, and a warning on every run.
 */

import { createWriteStream } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { exportChunks, NEVER_EXPORTED, isSecretSetting } from '../../helpers/export-data.ts'
import { unusablePassword, defaultAuthor, withDryRun, Report } from './import-common.mjs'
import { importExport } from './json-import.mjs'

export const BACKUP_PREFIX = 'basicben-backup-'

export const PERSONAL_DATA_WARNING =
  'This backup contains personal data: account email addresses and names, and commenters\' names\n' +
  'and email addresses. Store it encrypted, with access limited to the people who run the site,\n' +
  'and delete old copies (--keep). It contains no passwords, two-factor secrets, passkeys or tokens.'

/**
 * `basicben-backup-20261123T101500123Z-1a2b3c4d5e6f7a8b`, plus an extension.
 *
 * Milliseconds are kept so two backups in the same second still sort.
 *
 * The timestamp sorts and is what retention reads; the random tail makes the
 * name unguessable, so a backup that does end up somewhere world-readable is
 * not found by counting timestamps.
 */
export function backupBaseName(now = new Date(), random = randomBytes(8).toString('hex')) {
  const stamp = now.toISOString().replace(/[-:.]/g, '')
  return `${BACKUP_PREFIX}${stamp}-${random}`
}

const NAME = /^basicben-backup-(\d{8}T\d{6}(?:\d{3})?Z)-([0-9a-f]{16})(\..+)$/

/** The time a backup name records, or null for a file that is not ours. */
export function parseBackupName(name) {
  const file = String(name).split('/').pop()
  const match = NAME.exec(file)
  if (!match) return null

  const s = match[1]
  const ms = s.length > 16 ? `.${s.slice(15, 18)}` : ''
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}${ms}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : { date, set: `${BACKUP_PREFIX}${match[1]}-${match[2]}`, ext: match[3] }
}

/**
 * Which files to delete so that only the newest `keep` backups remain.
 *
 * A backup is a *set* — the JSON and, with --sqlite-copy, the database file
 * share a base name — so retention counts sets, not files: `--keep 7` keeps
 * seven backups, not three and a half. Anything that does not parse as a
 * backup name is never touched; retention must not be a way to delete files
 * that merely share a directory or prefix.
 */
export function selectForDeletion(names, keep) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be a whole number of at least 1')

  const sets = new Map()
  for (const name of names) {
    const parsed = parseBackupName(name)
    if (!parsed) continue
    if (!sets.has(parsed.set)) sets.set(parsed.set, { date: parsed.date, names: [] })
    sets.get(parsed.set).names.push(name)
  }

  return [...sets.values()]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(keep)
    .flatMap((set) => set.names)
    .sort()
}

/**
 * Where uploads go, from the environment.
 *
 * `BACKUP_S3_*` first: a backup bucket separate from the media bucket is the
 * recommended setup, because a media bucket is usually public — R2 with a
 * custom domain serves *every* key in it — and a backup holds every user's
 * address. Falling back to the media bucket's `S3_*` works, under the
 * `backups/` prefix, and is reported as `shared: true` so the CLI can say so.
 */
export function backupStorageConfig(env = process.env) {
  const own = Boolean(env.BACKUP_S3_BUCKET)
  const pick = (name) => (own ? env[`BACKUP_S3_${name}`] ?? env[`S3_${name}`] : env[`S3_${name}`])

  const config = {
    driver: 's3',
    bucket: own ? env.BACKUP_S3_BUCKET : env.S3_BUCKET,
    accessKeyId: pick('ACCESS_KEY_ID'),
    secretAccessKey: pick('SECRET_ACCESS_KEY'),
    endpoint: pick('ENDPOINT'),
    region: pick('REGION') || 'auto'
  }

  if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) return null

  return { config, shared: !own, publicMediaUrl: !own && Boolean(env.S3_PUBLIC_URL) }
}

/** `backups/` unless told otherwise, always ending in exactly one slash. */
export function normalizePrefix(prefix = 'backups/') {
  const trimmed = String(prefix).replace(/^\/+|\/+$/g, '')
  if (!trimmed || trimmed.includes('..')) throw new Error('--prefix must be a plain folder name such as backups')
  return `${trimmed}/`
}

/**
 * Write the JSON export to `path`, gzipped if asked.
 *
 * Streamed end to end — the export yields fragments and they go straight to
 * the file — so a large site is never held in memory whole.
 */
export async function writeJsonBackup(db, path, { gzip = false, revisions = true, now } = {}) {
  const source = Readable.from(exportChunks(db, { revisions, now }))
  if (gzip) await pipeline(source, createGzip({ level: 9 }), createWriteStream(path))
  else await pipeline(source, createWriteStream(path))
  return (await stat(path)).size
}

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`

/**
 * A consistent copy of a SQLite database, with secrets removed.
 *
 * `VACUUM INTO` is SQLite's own online backup: one statement, a transaction-
 * consistent snapshot even while the app is writing, and a compacted file.
 * Copying the file with `cp` is not — a copy taken mid-write can be torn, and
 * a WAL-mode database's recent writes are in the `-wal` file beside it.
 *
 * Only for a local file. Turso and Postgres back up on the provider's side
 * (point-in-time recovery), and the JSON backup covers moving off them.
 */
export async function sqliteSnapshot(db, outPath) {
  if ((db.driver ?? 'sqlite') !== 'sqlite') {
    throw new Error(`--sqlite-copy needs the sqlite driver; this database is ${db.driver}. Use your provider's backups (Turso and Postgres both offer point-in-time recovery).`)
  }

  await db.exec(`VACUUM INTO ${quote(outPath)}`)
  scrubSqliteCopy(outPath)
  return (await stat(outPath)).size
}

/** Every table that holds credentials or per-database state, plus the IP column. */
export function scrubSqliteCopy(path) {
  const copy = new DatabaseSync(path)

  try {
    const tables = new Set(copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name))

    for (const table of NEVER_EXPORTED) {
      if (table === '_migrations' || table === 'sqlite_sequence') continue // the schema's own bookkeeping, needed to restore
      if (tables.has(table)) copy.exec(`DELETE FROM "${table}"`)
    }

    if (tables.has('users')) {
      // A password hash is a credential; an offline copy is where it gets
      // cracked. Accounts restored from this copy reset their password, the
      // same as accounts restored from the JSON.
      const update = copy.prepare('UPDATE users SET password = ? WHERE id = ?')
      for (const { id } of copy.prepare('SELECT id FROM users').all()) update.run(unusablePassword(), id)
    }

    if (tables.has('comments')) {
      const columns = copy.prepare('PRAGMA table_info(comments)').all().map((row) => row.name)
      if (columns.includes('author_ip')) copy.exec('UPDATE comments SET author_ip = NULL')
    }

    if (tables.has('settings')) {
      const remove = copy.prepare('DELETE FROM settings WHERE key = ?')
      for (const { key } of copy.prepare('SELECT key FROM settings').all()) {
        if (isSecretSetting(key)) remove.run(key)
      }
    }

    // Deleted rows stay readable in free pages until the file is rebuilt.
    copy.exec('VACUUM')
  } finally {
    copy.close()
  }
}

/** Delete local backups beyond the newest `keep`. Returns what was deleted. */
export async function pruneLocal(dir, keep) {
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const doomed = selectForDeletion(names, keep)
  for (const name of doomed) await rm(join(dir, name), { force: true })
  return doomed
}

/** Every key under the prefix, following continuation tokens. */
export async function listAll(storage, prefix) {
  const keys = []
  let cursor

  do {
    const page = await storage.list({ prefix, cursor })
    for (const item of page.items) keys.push(item.key)
    cursor = page.cursor
  } while (cursor)

  return keys
}

/** Delete bucket backups beyond the newest `keep`. Only keys under `prefix`. */
export async function pruneBucket(storage, prefix, keep) {
  const keys = (await listAll(storage, prefix)).filter((key) => key.startsWith(prefix))
  const doomed = selectForDeletion(keys, keep)
  for (const key of doomed) await storage.delete(key)
  return doomed
}

/** Whether a buffer is gzip, by its magic number rather than its name. */
export function isGzip(buffer) {
  return buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
}

/**
 * Content tables that make a database "not empty" for restore purposes.
 *
 * Settings are deliberately not on the list: migrations seed defaults, so a
 * freshly migrated database already has some.
 */
export const CONTENT_TABLES = ['users', 'posts', 'pages', 'comments', 'media', 'categories', 'tags']

/** Row counts of the content tables that have rows. Missing tables count as empty. */
export async function nonEmptyTables(db) {
  const found = {}
  for (const table of CONTENT_TABLES) {
    try {
      const row = await db.get(`SELECT COUNT(*) AS n FROM "${table}"`)
      const n = Number(row?.n ?? 0)
      if (n > 0) found[table] = n
    } catch {
      // Not migrated yet; the restore checks for that separately.
    }
  }
  return found
}

/**
 * Load a backup into a database: the JSON import, made fit for a restore.
 *
 * The importer was built for merging one site into another, which needs an
 * admin already in the target to own orphaned content. A restore is the
 * opposite case — the target is empty and the admins are *in the file* — so
 * this imports the accounts first, takes the first imported admin as the
 * fallback owner, and then imports everything else. Both passes are one
 * transaction: a restore that fails halfway leaves the database as empty as
 * it found it, not half a site that the "empty database only" rule would
 * then refuse to restore over.
 *
 * Refuses a database that already has content unless `force` is set; with it,
 * the import's usual merge rules apply (existing rows matched by natural key
 * and left alone).
 */
export async function restoreBackup(db, doc, { force = false, dryRun = false, log } = {}) {
  const existing = await nonEmptyTables(db)
  if (Object.keys(existing).length && !force) {
    const list = Object.entries(existing).map(([table, n]) => `${table} (${n})`).join(', ')
    throw new Error(
      `The target database is not empty: ${list}.\n` +
      'A restore is for an empty, freshly migrated database. Pass --force to merge into this one\n' +
      'instead (existing rows are matched by slug/email and left alone) — after a --dry-run.'
    )
  }

  const users = { ...doc, tables: { users: doc.tables.users ?? [] } }

  const run = async (tx) => {
    const accounts = await importExport(tx, users, { defaultAuthorId: null, log })
    const admin = await defaultAuthor(tx)
    if (!admin) {
      throw new Error('The backup has no admin account, so restored content would have no owner. Register an admin first and use --force.')
    }
    const content = await importExport(tx, doc, { defaultAuthorId: admin.id, log, report: new Report() })
    return { accounts, content, admin }
  }

  if (dryRun) return withDryRun(db, true, run)

  let result
  await db.transaction(async (tx) => {
    result = await run(tx)
  })
  return result
}
