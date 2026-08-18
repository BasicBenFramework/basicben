/**
 * SQLite adapter using Node.js built-in node:sqlite.
 * Provides synchronous API wrapped for consistency with async Postgres adapter.
 * Requires Node.js 24+ (node:sqlite stabilized in v24 LTS).
 */

import { DatabaseSync } from 'node:sqlite'

/**
 * Create SQLite adapter
 *
 * @param {string} url - Path to SQLite database file
 * @param {Object} options - Additional options
 */
export async function createSqliteAdapter(url, options = {}) {
  const dbPath = url.replace('sqlite://', '').replace('file://', '')

  const db = new DatabaseSync(dbPath, {
    enableForeignKeyConstraints: true
  })

  // Enable WAL mode for better concurrency
  if (options.wal !== false) {
    db.exec('PRAGMA journal_mode = WAL')
  }

  // Transaction nesting depth. Only the outermost BEGIN/COMMIT is issued.
  let depth = 0

  const adapter = {
    /**
     * Driver name for query builder
     */
    driver: 'sqlite',

    /**
     * Run INSERT/UPDATE/DELETE
     */
    run(sql, params = []) {
      const stmt = db.prepare(sql)
      const result = stmt.run(...normalizeParams(params))

      return {
        lastInsertRowid: result.lastInsertRowid,
        changes: result.changes
      }
    },

    /**
     * Get single row
     */
    get(sql, params = []) {
      const stmt = db.prepare(sql)
      return stmt.get(...normalizeParams(params))
    },

    /**
     * Get all rows
     */
    all(sql, params = []) {
      const stmt = db.prepare(sql)
      return stmt.all(...normalizeParams(params))
    },

    /**
     * Execute raw SQL (multiple statements)
     */
    exec(sql) {
      db.exec(sql)
    },

    /**
     * Run function in transaction.
     *
     * The callback receives the adapter so the same code works against Postgres,
     * which passes a transaction-scoped adapter. The result is awaited: an async
     * callback would otherwise commit before its work finished, and a rejection
     * would escape the rollback.
     *
     * A nested call joins the transaction already open instead of starting
     * another, which SQLite refuses outright ("cannot start a transaction
     * within a transaction"). Only the outermost call commits or rolls back, so
     * an inner failure still unwinds the whole thing — there are no savepoints
     * here and a partial rollback would be worse than none. The depth counter
     * is safe because this connection is synchronous: nothing else can be
     * mid-transaction on it.
     */
    async transaction(fn) {
      if (depth > 0) {
        depth++
        try {
          return await fn(adapter)
        } finally {
          depth--
        }
      }

      db.exec('BEGIN TRANSACTION')
      depth = 1

      try {
        const result = await fn(adapter)
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      } finally {
        depth = 0
      }
    },

    /**
     * Close database connection
     */
    close() {
      db.close()
    },

    /**
     * Get underlying DatabaseSync instance
     */
    get raw() {
      return db
    }
  }

  return adapter
}

/**
 * Normalize params to array format
 */
function normalizeParams(params) {
  if (Array.isArray(params)) {
    return params.map(bindable)
  }
  if (params === undefined || params === null) {
    return []
  }
  return [bindable(params)]
}

/**
 * Coerce a JS value into something node:sqlite will accept.
 *
 * node:sqlite rejects booleans outright ("Provided value cannot be bound"),
 * which would make `where('published', true)` throw even though SQLite stores
 * booleans as integers. undefined becomes NULL for the same reason.
 */
function bindable(value) {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === undefined) return null
  return value
}
