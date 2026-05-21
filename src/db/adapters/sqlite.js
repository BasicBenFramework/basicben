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

  return {
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
     * Run function in transaction
     */
    transaction(fn) {
      db.exec('BEGIN TRANSACTION')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
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
}

/**
 * Normalize params to array format
 */
function normalizeParams(params) {
  if (Array.isArray(params)) {
    return params
  }
  if (params === undefined || params === null) {
    return []
  }
  return [params]
}
