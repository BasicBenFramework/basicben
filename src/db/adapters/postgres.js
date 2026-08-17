/**
 * Postgres adapter using pg (node-postgres).
 * Provides async interface matching the SQLite adapter.
 */

let pg = null

/**
 * Rewrite `?` placeholders as `$1, $2, …`.
 *
 * The query builder already emits the right form through `Grammar`, but
 * hand-written SQL does not, and there is a lot of hand-written SQL: the
 * template's models are full of `WHERE id = ?`. Portable migrations only get an
 * app as far as a schema it then cannot query, so the translation belongs here,
 * once, rather than in every model.
 *
 * Two things are deliberately left alone:
 *
 *  - **Anything inside a string literal.** `WHERE note = 'why?'` binds nothing.
 *  - **jsonb operators.** Postgres spells key-existence `?`, `?|` and `?&`, and
 *    a query written against Postgres on purpose must survive being run.
 *
 * SQL that already uses `$n` is returned untouched, so builder output and
 * anything a user wrote for Postgres directly are both safe.
 *
 * @param {string} sql
 * @returns {string}
 */
export function toNumberedPlaceholders(sql) {
  if (typeof sql !== 'string' || !sql.includes('?')) return sql

  // Already Postgres-shaped. Renumbering would corrupt it.
  if (/\$\d/.test(sql)) return sql

  let out = ''
  let index = 0
  let quote = null

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]

    if (quote) {
      out += char
      // '' inside a single-quoted string is an escaped quote, not the end.
      if (char === quote && sql[i + 1] === quote) {
        out += sql[++i]
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      out += char
      continue
    }

    if (char === '?') {
      const next = sql[i + 1]

      // ?, ?| and ?& are jsonb operators, not placeholders.
      if (next === '?' || next === '|' || next === '&') {
        out += char + next
        i++
        continue
      }

      out += `$${++index}`
      continue
    }

    out += char
  }

  return out
}

/**
 * Load pg dynamically
 */
async function loadDriver() {
  if (pg) return pg

  try {
    pg = await import('pg')
    return pg
  } catch {
    throw new Error(
      'pg is required for Postgres support.\n' +
      'Install it with: npm install pg'
    )
  }
}

/**
 * Settings for the connection pool.
 *
 * Separate from the adapter so they can be asserted without a Postgres server.
 *
 * @param {string} url - Postgres connection string
 * @param {Object} options - Additional options
 * @returns {Object} Options for pg's Pool
 */
export function poolOptions(url, options = {}) {
  return {
    connectionString: url,
    max: options.poolSize || 10,
    idleTimeoutMillis: options.idleTimeout || 30000,
    connectionTimeoutMillis: options.connectionTimeout || 2000,

    // An idle client keeps the event loop alive until it times out, which left
    // every CLI command sitting for the full idle timeout — 30 seconds by
    // default — after its work was done and committed. A long-running server
    // holds itself open with its own listener, so it is unaffected.
    allowExitOnIdle: options.allowExitOnIdle !== false
  }
}

/**
 * Create Postgres adapter
 *
 * @param {string} url - Postgres connection string
 * @param {Object} options - Additional options
 */
export async function createPostgresAdapter(url, options = {}) {
  const { Pool } = await loadDriver()

  const pool = new Pool(poolOptions(url, options))

  // Test connection
  try {
    const client = await pool.connect()
    client.release()
  } catch (err) {
    throw new Error(`Failed to connect to Postgres: ${err.message}`)
  }

  return {
    /**
     * Driver name for query builder
     */
    driver: 'postgres',

    /**
     * Run INSERT/UPDATE/DELETE
     */
    async run(sql, params = []) {
      const result = await pool.query(toNumberedPlaceholders(sql), normalizeParams(params))

      // Try to get lastInsertRowid from RETURNING clause
      let lastInsertRowid = null
      if (result.rows && result.rows[0] && result.rows[0].id !== undefined) {
        lastInsertRowid = result.rows[0].id
      }

      return {
        lastInsertRowid,
        changes: result.rowCount
      }
    },

    /**
     * Get single row
     */
    async get(sql, params = []) {
      const result = await pool.query(toNumberedPlaceholders(sql), normalizeParams(params))
      return result.rows[0]
    },

    /**
     * Get all rows
     */
    async all(sql, params = []) {
      const result = await pool.query(toNumberedPlaceholders(sql), normalizeParams(params))
      return result.rows
    },

    /**
     * Execute raw SQL
     */
    async exec(sql) {
      await pool.query(sql)
    },

    /**
     * Run function in transaction
     */
    async transaction(fn) {
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        // Create a transaction-scoped adapter
        const txAdapter = {
          async run(sql, params = []) {
            const result = await client.query(toNumberedPlaceholders(sql), normalizeParams(params))
            let lastInsertRowid = null
            if (result.rows && result.rows[0] && result.rows[0].id !== undefined) {
              lastInsertRowid = result.rows[0].id
            }
            return { lastInsertRowid, changes: result.rowCount }
          },
          async get(sql, params = []) {
            const result = await client.query(toNumberedPlaceholders(sql), normalizeParams(params))
            return result.rows[0]
          },
          async all(sql, params = []) {
            const result = await client.query(toNumberedPlaceholders(sql), normalizeParams(params))
            return result.rows
          },
          async exec(sql) {
            await client.query(sql)
          }
        }

        const result = await fn(txAdapter)
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },

    /**
     * Close connection pool
     */
    async close() {
      await pool.end()
    },

    /**
     * Get underlying pool
     */
    get raw() {
      return pool
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
