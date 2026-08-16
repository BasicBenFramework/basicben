/**
 * Database adapter loader.
 * Provides a unified interface for SQLite and Postgres.
 */

import { loadConfig } from '../server/loader.js'
import { QueryBuilder } from './QueryBuilder.js'

let dbInstance = null

/**
 * Database adapter interface:
 *
 * - run(sql, params)     → { lastInsertRowid, changes }
 * - get(sql, params)     → single row or undefined
 * - all(sql, params)     → array of rows
 * - exec(sql)            → run raw SQL (for migrations)
 * - transaction(fn)      → wrap fn in BEGIN/COMMIT
 * - close()              → close connection
 */

/**
 * Get or create database connection
 */
export async function getDb() {
  if (dbInstance) {
    return dbInstance
  }

  const config = await loadConfig()
  const dbConfig = config.db || {}

  const driver = dbConfig.driver || detectDriver(dbConfig)

  switch (driver) {
    case 'sqlite': {
      const { createSqliteAdapter } = await import('./adapters/sqlite.js')
      dbInstance = await createSqliteAdapter(resolveUrl(dbConfig, 'sqlite'), dbConfig)
      break
    }

    case 'postgres':
    case 'pg': {
      const { createPostgresAdapter } = await import('./adapters/postgres.js')
      dbInstance = await createPostgresAdapter(resolveUrl(dbConfig, 'postgres'), dbConfig)
      break
    }

    case 'turso':
    case 'libsql': {
      const { createTursoAdapter } = await import('./adapters/turso.js')
      dbInstance = await createTursoAdapter(resolveUrl(dbConfig, 'turso'), dbConfig)
      break
    }

    default:
      throw new Error(
        `Unknown database driver: ${driver}\n` +
        'Supported drivers: sqlite, postgres, turso'
      )
  }

  return dbInstance
}

/**
 * Work out the driver from the environment when the config does not name one.
 *
 * A connection string already says which database it points at, so requiring
 * `driver` alongside it is a step that only exists to be forgotten. An explicit
 * `driver` in basicben.config.js always wins.
 *
 * @param {Object} dbConfig
 * @returns {string}
 */
export function detectDriver(dbConfig = {}) {
  const url = dbConfig.url || process.env.DATABASE_URL || ''

  if (process.env.TURSO_URL || /^(libsql|wss):\/\//i.test(url)) return 'turso'
  if (/^postgres(ql)?:\/\//i.test(url)) return 'postgres'

  return 'sqlite'
}

/**
 * Resolve the connection URL for a driver.
 *
 * Turso reads TURSO_URL as well, since that is the variable its own tooling
 * prints and the one the templates document.
 *
 * @param {Object} dbConfig
 * @param {string} driver
 * @returns {string}
 */
export function resolveUrl(dbConfig = {}, driver = 'sqlite') {
  if (dbConfig.url) return dbConfig.url

  if (driver === 'turso') {
    const url = process.env.TURSO_URL || process.env.DATABASE_URL
    if (!url) {
      throw new Error(
        'Turso requires a database URL. Set TURSO_URL (or DATABASE_URL), or db.url in basicben.config.js.'
      )
    }
    return url
  }

  return process.env.DATABASE_URL || './database.sqlite'
}

/**
 * Shorthand exports for common operations
 * These use the default connection
 */
export const db = {
  async run(sql, params) {
    const conn = await getDb()
    return conn.run(sql, params)
  },

  async get(sql, params) {
    const conn = await getDb()
    return conn.get(sql, params)
  },

  async all(sql, params) {
    const conn = await getDb()
    return conn.all(sql, params)
  },

  async exec(sql) {
    const conn = await getDb()
    return conn.exec(sql)
  },

  async transaction(fn) {
    const conn = await getDb()
    return conn.transaction(fn)
  },

  async close() {
    if (dbInstance) {
      await dbInstance.close()
      dbInstance = null
    }
  },

  /**
   * Create a query builder for a table.
   * Provides fluent API with mass assignment protection.
   *
   * @param {string} table - Table name
   * @returns {Promise<QueryBuilder>}
   */
  async table(table) {
    const conn = await getDb()
    return new QueryBuilder(conn, table, conn.driver || 'sqlite')
  }
}

/**
 * Reset connection (for testing)
 */
export function resetDb() {
  dbInstance = null
}

/**
 * Create a query builder for a table.
 * Provides fluent API with mass assignment protection.
 *
 * @param {string} table - Table name
 * @returns {Promise<QueryBuilder>}
 *
 * @example
 * const users = await query('users').where('active', true).get()
 * await query('users').only('name', 'email').insert(req.body)
 */
export async function query(table) {
  const conn = await getDb()
  return new QueryBuilder(conn, table, conn.driver || 'sqlite')
}

// Re-export QueryBuilder and Grammar for advanced usage
export { QueryBuilder } from './QueryBuilder.js'
export { Grammar } from './Grammar.js'
