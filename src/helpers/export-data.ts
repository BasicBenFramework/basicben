/**
 * The full-content export: everything a site is, in one JSON document.
 *
 * Shared by the admin download (`GET /api/export`) and `scripts/export.mjs`,
 * and read back by `scripts/import-json.mjs`. The format is documented in
 * `docs/import-export.md`; bump `EXPORT_VERSION` for any change an older
 * importer would misread, and teach the importer the old shape before doing so.
 *
 * ## Why this file imports (almost) nothing
 *
 * The scripts are plain Node, and loading this should not load the app with
 * it. Taking the database handle as an argument, rather than calling
 * `getDb()`, keeps this file loadable from both sides and lets the tests hand
 * it an in-memory database.
 *
 * ## What is left out, and why it is an allowlist
 *
 * Tables are exported only if they are named below. A table added later is
 * reported under `omitted.tables` rather than exported, because the tables
 * that must never leave the database — hashed credentials, TOTP secrets,
 * passkeys, rate-limiter state — are exactly the kind a blocklist forgets the
 * day someone adds another one. An export is a file people email to each
 * other; it should contain content, not ways in.
 */

// The one import: the features' manifests, which are static data and import
// nothing at runtime themselves, so plain Node still loads this file.
import features from '../features.manifest.ts'

/** Identifies the document, so an importer can refuse something else. */
export const EXPORT_FORMAT = 'basicben-export'

/** Bumped for any change an older importer would misread. */
export const EXPORT_VERSION = 1

/** The handle both the app's adapter and the scripts' adapter satisfy. */
export interface ExportDb {
  driver?: string
  all: (sql: string, params?: unknown[]) => unknown
  get: (sql: string, params?: unknown[]) => unknown
}

interface TableSpec {
  name: string
  /** Columns never written out, whatever the table holds. */
  omit?: string[]
  /** Only exported when the caller asks for it. */
  optional?: 'revisions'
}

/**
 * Exported tables, in dependency order: a row only ever refers to rows in
 * tables listed before it (or to its own table), so an importer reading
 * top to bottom can remap every id as it goes.
 *
 * `menus`, `menu_items`, `redirects` and `snippets` belong to features that may not be
 * installed; a table that does not exist is simply absent from the output.
 */
export const EXPORT_TABLES: TableSpec[] = [
  // The password hash is a credential, and `token_version` is session state
  // that means nothing in another database. Imported users reset a password.
  { name: 'users', omit: ['password', 'token_version'] },
  { name: 'media' },
  { name: 'categories' },
  { name: 'tags' },
  { name: 'posts' },
  { name: 'post_categories' },
  { name: 'post_tags' },
  // Revisions can be most of a database's size, and most moves do not need
  // them, so they are opt-in.
  { name: 'post_revisions', optional: 'revisions' },
  { name: 'pages' },
  // The commenter's address is a spam signal for this install, and personal
  // data an export file has no business carrying around.
  { name: 'comments', omit: ['author_ip'] },
  { name: 'settings' },
  { name: 'menus' },
  { name: 'menu_items' },
  { name: 'redirects' },
  { name: 'snippets' },
  // Each feature's own, from its manifest, after core's: a feature's rows may
  // refer to core's, never the other way round.
  ...features.flatMap((feature) => feature.exportTables ?? [])
]

/**
 * Tables known to hold secrets or per-database state. Listed so the
 * `omitted` report can say *why* they are missing rather than leaving an
 * operator to wonder whether the export is incomplete.
 */
export const NEVER_EXPORTED = [
  'auth_tokens',
  'user_two_factor',
  'user_credentials',
  'api_tokens',
  'rate_limits',
  // Who has a post open right now: meaningless anywhere else.
  'post_locks',
  // When background jobs last ran here. True of this database only.
  'ops_heartbeats',
  '_migrations',
  'sqlite_sequence',
  // Each feature's own, from its manifest.
  ...features.flatMap((feature) => feature.neverExported ?? [])
]

/**
 * Setting keys that look like credentials.
 *
 * Settings are free-form key/value, so a plugin can store an API key there.
 * Matching on the name is a heuristic, which is why matching keys are listed
 * under `omitted.settings` — a false positive costs a setting re-entered by
 * hand, a false negative would put a key in a file.
 */
const SECRET_SETTING = /(secret|password|passwd|token|api[_-]?key|private[_-]?key|credential|smtp_pass)/i

export function isSecretSetting(key: unknown): boolean {
  return SECRET_SETTING.test(String(key ?? ''))
}

/** Identifiers are interpolated, so anything that is not a plain name is refused. */
function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Refusing identifier: ${name}`)
  return `"${name}"`
}

const isPostgres = (db: ExportDb) => db.driver === 'postgres' || db.driver === 'pg'

/** Every table in the database, so the export can report what it left out. */
export async function listTables(db: ExportDb): Promise<string[]> {
  const rows = (await db.all(
    isPostgres(db)
      ? 'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()'
      : "SELECT name FROM sqlite_master WHERE type = 'table'"
  )) as Array<{ name: string }>

  return rows.map((row) => String(row.name))
}

/**
 * A table's columns, or an empty list if it does not exist.
 *
 * Asked of the catalogue rather than of a `SELECT *`, which returns no column
 * names at all on an empty SQLite table.
 */
export async function columnsOf(db: ExportDb, table: string): Promise<string[]> {
  ident(table)

  const rows = (await db.all(
    isPostgres(db)
      ? 'SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position'
      : `PRAGMA table_info(${ident(table)})`,
    isPostgres(db) ? [table] : []
  )) as Array<{ name: string }>

  return rows.map((row) => String(row.name))
}

export interface ExportOptions {
  /** Include `post_revisions`. Off by default. */
  revisions?: boolean
  /** Rows read per query, so a large table is never held whole. */
  pageSize?: number
  /** Stamped into the document; defaults to now. */
  now?: Date
}

/**
 * The export as a sequence of JSON fragments.
 *
 * Yielded in pieces so the endpoint can stream a large site to the client
 * without building the whole document in memory, and the script can write it
 * to a file the same way. Joined, the fragments are one valid JSON document.
 */
export async function* exportChunks(db: ExportDb, options: ExportOptions = {}): AsyncGenerator<string> {
  const pageSize = options.pageSize ?? 500
  const present = new Set(await listTables(db))
  const omittedColumns: Record<string, string[]> = {}
  const omittedSettings: string[] = []
  const counts: Record<string, number> = {}

  yield `{"format":${JSON.stringify(EXPORT_FORMAT)},"version":${EXPORT_VERSION}` +
    `,"exported_at":${JSON.stringify((options.now ?? new Date()).toISOString())}` +
    `,"driver":${JSON.stringify(db.driver ?? 'sqlite')}` +
    `,"options":${JSON.stringify({ revisions: Boolean(options.revisions) })}` +
    ',"tables":{'

  let firstTable = true

  for (const spec of EXPORT_TABLES) {
    if (!present.has(spec.name)) continue
    if (spec.optional === 'revisions' && !options.revisions) continue

    const columns = await columnsOf(db, spec.name)
    const omit = new Set(spec.omit ?? [])
    const kept = columns.filter((column) => !omit.has(column))
    const dropped = columns.filter((column) => omit.has(column))

    if (dropped.length) omittedColumns[spec.name] = dropped

    // Paging needs a stable order, and join tables have no id: ordering by
    // every column is stable for them because the row *is* its key.
    const order = columns.includes('id') ? ident('id') : columns.map(ident).join(', ')
    const select = kept.map(ident).join(', ')

    yield `${firstTable ? '' : ','}${JSON.stringify(spec.name)}:[`
    firstTable = false

    let firstRow = true
    let count = 0

    for (let offset = 0; ; offset += pageSize) {
      const rows = (await db.all(
        `SELECT ${select} FROM ${ident(spec.name)} ORDER BY ${order} LIMIT ? OFFSET ?`,
        [pageSize, offset]
      )) as Array<Record<string, unknown>>

      for (const row of rows) {
        if (spec.name === 'settings' && isSecretSetting(row.key)) {
          omittedSettings.push(String(row.key))
          continue
        }

        yield `${firstRow ? '' : ','}${JSON.stringify(plain(row))}`
        firstRow = false
        count++
      }

      if (rows.length < pageSize) break
    }

    counts[spec.name] = count
    yield ']'
  }

  const exported = new Set(EXPORT_TABLES.map((spec) => spec.name))
  const omittedTables = [...present]
    .filter((name) => !exported.has(name) || (name === 'post_revisions' && !options.revisions))
    .sort()
    .map((name) => ({
      name,
      reason: NEVER_EXPORTED.includes(name)
        ? 'credentials or per-database state'
        : name === 'post_revisions'
          ? 'revisions not requested'
          : 'not a table this export knows; nothing in it was exported'
    }))

  yield '},"counts":' + JSON.stringify(counts) +
    ',"omitted":' + JSON.stringify({
      tables: omittedTables,
      columns: omittedColumns,
      settings: omittedSettings
    }) +
    '}'
}

/** The whole export as a string. For tests and small sites. */
export async function exportToString(db: ExportDb, options: ExportOptions = {}): Promise<string> {
  let out = ''
  for await (const chunk of exportChunks(db, options)) out += chunk
  return out
}

/**
 * A row as plain JSON values.
 *
 * SQLite can hand back BigInt for large integers and Postgres hands back Date
 * objects; neither survives `JSON.stringify` the way a reader expects.
 */
function plain(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') out[key] = Number(value)
    else if (value instanceof Date) out[key] = value.toISOString()
    else out[key] = value
  }

  return out
}
