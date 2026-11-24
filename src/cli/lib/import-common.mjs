/**
 * Plumbing shared by every importer: argument parsing, schema-tolerant row
 * writes, timestamps, the dry run, and the summary report.
 *
 * ## Schema tolerance
 *
 * Rows are filtered to the columns the target table actually has before they
 * are written. Importers run against databases at whatever migration they
 * happen to be at, and features land as new columns all the time; a column
 * the importer knows about and the database does not is dropped, not fatal.
 */

import { randomBytes } from 'node:crypto'
import { columnsOf } from '../../helpers/export-data.ts'

/**
 * Parse `--flag` and `--option value` arguments.
 *
 * @param {string[]} argv
 * @param {{ flags?: string[], options?: string[] }} spec
 * @returns {{ flags: Record<string, boolean>, options: Record<string, string>, positional: string[] }}
 */
export function parseArgs(argv, spec = {}) {
  const flags = Object.fromEntries((spec.flags ?? []).map((f) => [f, false]))
  const options = {}
  const positional = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }

    const [name, inline] = arg.slice(2).split(/=(.*)/s)

    if ((spec.options ?? []).includes(name)) {
      const value = inline ?? argv[++i]
      if (value === undefined) throw new Error(`--${name} needs a value`)
      options[name] = value
    } else if (name in flags) {
      flags[name] = true
    } else {
      throw new Error(`Unknown option --${name}`)
    }
  }

  return { flags, options, positional }
}

const columnCache = new WeakMap()

/** The target table's columns, asked once per table per connection. */
export async function tableColumns(db, table) {
  let perDb = columnCache.get(db)
  if (!perDb) columnCache.set(db, (perDb = new Map()))
  if (!perDb.has(table)) perDb.set(table, new Set(await columnsOf(db, table)))
  return perDb.get(table)
}

/** Forget cached columns — for tests that migrate between runs. */
export function clearColumnCache(db) {
  columnCache.delete(db)
}

/** Keep only the keys the table has, and drop undefined values. */
async function fit(db, table, row) {
  const columns = await tableColumns(db, table)
  return Object.fromEntries(
    Object.entries(row).filter(([key, value]) => columns.has(key) && value !== undefined)
  )
}

const quote = (name) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Refusing identifier: ${name}`)
  return `"${name}"`
}

/**
 * Insert a row and return its id.
 *
 * `RETURNING id` on Postgres, because its adapter only learns the new id from
 * a returned row — a bare INSERT there writes the row and reports null, and
 * the failure surfaces later as a foreign key pointing at nothing.
 */
export async function insertRow(db, table, row) {
  const data = await fit(db, table, row)
  const keys = Object.keys(data)
  const columns = await tableColumns(db, table)
  const returning = (db.driver === 'postgres' || db.driver === 'pg') && columns.has('id') ? ' RETURNING id' : ''

  const result = await db.run(
    `INSERT INTO ${quote(table)} (${keys.map(quote).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})${returning}`,
    Object.values(data)
  )

  return result.lastInsertRowid === null || result.lastInsertRowid === undefined
    ? null
    : Number(result.lastInsertRowid)
}

/** Update a row by id with whichever of `row`'s columns the table has. */
export async function updateRow(db, table, id, row) {
  const data = await fit(db, table, row)
  delete data.id
  const keys = Object.keys(data)
  if (keys.length === 0) return

  await db.run(
    `UPDATE ${quote(table)} SET ${keys.map((k) => `${quote(k)} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  )
}

/**
 * A stored timestamp, as the app writes them: ISO-8601 UTC with a `Z`.
 *
 * Accepts what the sources produce — ISO strings, WordPress's zone-less
 * `YYYY-MM-DD HH:MM:SS` (read as UTC, so pass the `_gmt` field), Ghost's
 * millisecond ISO — and returns null for nothing or nonsense, including
 * WordPress's `0000-00-00 00:00:00` for "never".
 */
export function toTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' && value.startsWith('0000-00-00')) return null

  const text = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value

  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * The object key behind a media URL.
 *
 * `https://cdn.example.com/2025/11/x.jpeg` is stored as `2025/11/x.jpeg`,
 * because `publicUrl()` prepends the configured domain. Storing the absolute
 * URL instead would produce `/uploads/https%3A%2F%2F...` on any driver.
 */
export function objectKey(url) {
  try {
    const key = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''))
    return key || null
  } catch {
    return null
  }
}

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  pdf: 'application/pdf', zip: 'application/zip'
}

/** A MIME type from a file name, for sources that do not say. */
export function mimeFromName(name) {
  const ext = /\.([A-Za-z0-9]+)$/.exec(String(name ?? ''))?.[1]?.toLowerCase()
  return (ext && MIME[ext]) || null
}

/**
 * A password hash no password can match.
 *
 * Imported authors get an account so their posts keep a byline, but nobody
 * chose a password for it, and inventing one would mean an account anyone
 * holding the importer's output could sign in to. A stored hash has six
 * colon-separated parts; this has two, so `verifyPassword` rejects it before
 * doing any work. The owner signs in by resetting the password, which proves
 * they control the address.
 */
export function unusablePassword() {
  return `!imported:${randomBytes(18).toString('hex')}`
}

/**
 * A slug not yet used in `table`, built from `base`.
 *
 * Numbered the way the CMS numbers its own (`jane`, `jane-2`), and checked
 * against the table rather than a local set so it holds across runs.
 */
export async function uniqueSlug(db, table, base, fallback = 'item') {
  const root = base || fallback
  let slug = root
  let suffix = 2

  while (await db.get(`SELECT 1 AS hit FROM ${quote(table)} WHERE slug = ?`, [slug])) {
    slug = `${root}-${suffix++}`
  }

  return slug
}

/** Thrown inside a dry run's transaction to roll everything back. */
class DryRunRollback extends Error {}

/**
 * Run `fn`, writing nothing if `dryRun` is set.
 *
 * A dry run executes the real import inside a transaction and rolls it back,
 * rather than following a separate "pretend" code path. Two paths drift — the
 * pretend one forgets a dedupe rule and reports creates the real one would
 * have skipped — so this reports exactly what a real run would do, because it
 * *is* a real run, undone.
 */
export async function withDryRun(db, dryRun, fn) {
  if (!dryRun) return fn(db)

  let result

  try {
    await db.transaction(async (tx) => {
      result = await fn(tx)
      throw new DryRunRollback()
    })
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }

  return result
}

/**
 * Counts of what happened to each kind of thing, plus notes worth reading.
 *
 * Every importer prints the same shape, so a dry run of a WXR file and of a
 * Ghost export can be compared line for line.
 */
export class Report {
  constructor() {
    this.counts = {}
    this.notes = []
    this.noteCounts = new Map()
  }

  count(entity, outcome, n = 1) {
    this.counts[entity] ??= {}
    this.counts[entity][outcome] = (this.counts[entity][outcome] ?? 0) + n
  }

  /** A note, collapsed by text so one gap does not print a thousand times. */
  note(text) {
    if (!this.noteCounts.has(text)) this.notes.push(text)
    this.noteCounts.set(text, (this.noteCounts.get(text) ?? 0) + 1)
  }

  get(entity, outcome) {
    return this.counts[entity]?.[outcome] ?? 0
  }

  toString() {
    const lines = Object.entries(this.counts).map(([entity, outcomes]) => {
      const parts = Object.entries(outcomes).map(([outcome, n]) => `${n} ${outcome}`)
      return `  ${entity.padEnd(12)} ${parts.join(', ')}`
    })

    const notes = this.notes.map((text) => {
      const n = this.noteCounts.get(text)
      return `  - ${text}${n > 1 ? ` (x${n})` : ''}`
    })

    return [
      'Summary:',
      ...(lines.length ? lines : ['  nothing to import']),
      ...(notes.length ? ['', 'Notes:', ...notes] : [])
    ].join('\n')
  }
}

/**
 * The account imported content falls back to: the first admin.
 *
 * Required, not optional — a post must have an author, and making one up is
 * not this script's business.
 */
export async function defaultAuthor(db) {
  return db.get(
    "SELECT id, name, email FROM users WHERE role IN ('admin', 'owner') ORDER BY id ASC LIMIT 1"
  )
}

export const NO_ADMIN_MESSAGE =
  'No admin user exists yet. Start the CMS and register — the first account\n' +
  'created becomes the admin — then run this again so imported content has\n' +
  'an author.'
