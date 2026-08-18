/**
 * Migration runner.
 * Tracks migrations in _migrations table, runs in order.
 */

import { readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getDb } from './index.js'
import { refuseLegacyLayout } from './layout.js'
import { Grammar } from './Grammar.js'
import { QueryBuilder } from './QueryBuilder.js'
import { isModuleFile, stripModuleExtension } from '../modules.js'

const MIGRATIONS_TABLE = '_migrations'

/**
 * Grammar for the connected driver.
 *
 * The runner's own bookkeeping is as dialect-sensitive as anything it runs:
 * placeholders are '?' on SQLite and $1, $2 on Postgres, and the two spell the
 * migrations table's DDL differently.
 *
 * It is also handed to every migration as a second argument, so what a user
 * writes can be as portable as what the runner writes. For a long time only the
 * latter was: the framework's own `_migrations` table was built through this
 * grammar while every shipped migration spelled `INTEGER PRIMARY KEY
 * AUTOINCREMENT` literally, so `basicben migrate` against the Postgres option
 * the templates advertise failed on the first table. Migrations taking only
 * `(db)` are unaffected — an extra argument is ignored.
 */
function grammarFor(db) {
  return new Grammar(db.driver || 'sqlite')
}

/**
 * Query builder scoped to the migrations table.
 */
function migrationsTable(db) {
  return new QueryBuilder(db, MIGRATIONS_TABLE, db.driver || 'sqlite')
}

/**
 * Create migrator instance
 *
 * @param {string} migrationsDir - Directory holding migration files
 * @param {Object} [connection] - Adapter to use instead of the configured
 *   connection. Tests pass one in to exercise the Postgres dialect, which is
 *   where the bookkeeping SQL differs, without a Postgres server.
 */
export async function createMigrator(migrationsDir = 'db/migrations', connection = null) {
  const db = connection || await getDb()
  const dir = resolve(process.cwd(), migrationsDir)

  refuseLegacyLayout(dir, 'migrations', 'db/migrations')

  // Ensure migrations table exists
  await ensureMigrationsTable(db)

  return {
    /**
     * Run all pending migrations
     */
    async migrate() {
      const pending = await getPendingMigrations(db, dir)

      if (pending.length === 0) {
        return { ran: [], message: 'Nothing to migrate.' }
      }

      const batch = await getNextBatch(db)
      const ran = []

      const grammar = grammarFor(db)

      for (const migration of pending) {
        const module = await loadMigration(migration.path)

        try {
          // The migration and the row saying it ran commit together, or neither
          // does. A migration that creates two tables and throws between them
          // used to leave the first one behind and no record of it, so the next
          // `migrate` failed on "table already exists" — with nothing to roll
          // back, because the bookkeeping never happened.
          await atomically(db, async (tx) => {
            await module.up(tx, grammar)
            await recordMigration(tx, migration.name, batch)
          })

          ran.push(migration.name)
        } catch (err) {
          throw new Error(`Migration failed: ${migration.name}\n${err.message}`)
        }
      }

      return { ran, batch }
    },

    /**
     * Roll back the last batch of migrations
     */
    async rollback() {
      const lastBatch = await getLastBatch(db)

      if (!lastBatch) {
        return { rolledBack: [], message: 'Nothing to rollback.' }
      }

      const migrations = await getMigrationsByBatch(db, lastBatch)
      const rolledBack = []
      const grammar = grammarFor(db)

      // Roll back in reverse order
      for (const migration of migrations.reverse()) {
        const filePath = findMigrationFile(dir, migration.migration)

        if (!filePath) {
          throw new Error(`Migration file not found: ${migration.migration}`)
        }

        const module = await loadMigration(filePath)

        try {
          await atomically(db, async (tx) => {
            await module.down(tx, grammar)
            await removeMigration(tx, migration.migration)
          })

          rolledBack.push(migration.migration)
        } catch (err) {
          throw new Error(`Rollback failed: ${migration.migration}\n${err.message}`)
        }
      }

      return { rolledBack, batch: lastBatch }
    },

    /**
     * Drop all tables and re-run all migrations
     */
    async fresh() {
      // Get all tables
      const tables = await getAllTables(db)

      // Nothing here drops in dependency order — the catalogue lists tables
      // arbitrarily — so foreign keys have to be got out of the way. Postgres
      // refuses to drop a table another table references unless told to
      // CASCADE, which drops the dependent constraint, not the dependent table.
      // SQLite has no such clause: it enforces constraints while emptying the
      // table, so a parent with rows referencing it cannot be dropped at all,
      // and enforcement goes off for the duration instead.
      const isPostgres = grammarFor(db).isPostgres()
      const cascade = isPostgres ? ' CASCADE' : ''

      if (!isPostgres) {
        await db.exec('PRAGMA foreign_keys = OFF')
      }

      try {
        // Drop all tables (except sqlite internal tables)
        for (const table of tables) {
          if (!table.startsWith('sqlite_')) {
            await db.exec(`DROP TABLE IF EXISTS "${table}"${cascade}`)
          }
        }
      } finally {
        // The SQLite adapter opens every connection with constraints on; a
        // failed drop must not leave this one running without them.
        if (!isPostgres) {
          await db.exec('PRAGMA foreign_keys = ON')
        }
      }

      // Re-create migrations table
      await ensureMigrationsTable(db)

      // Run all migrations
      return this.migrate()
    },

    /**
     * Get migration status
     */
    async status() {
      const files = getMigrationFiles(dir)
      const ran = await getRanMigrations(db)
      const ranSet = new Set(ran.map(m => m.migration))

      return files.map(file => ({
        name: file.name,
        ran: ranSet.has(file.name),
        batch: ran.find(m => m.migration === file.name)?.batch || null
      }))
    }
  }
}

/**
 * Run one migration's work and its bookkeeping as a single unit.
 *
 * Both drivers do transactional DDL, so a migration that throws halfway leaves
 * the schema as it was rather than half-changed. That failure was not
 * hypothetical: a rollback that died between two `down` steps left a database
 * where the next `migrate` failed with "column slug already exists", and the
 * only way out was editing `_migrations` by hand.
 *
 * The callback gets the transaction-scoped adapter and everything must go
 * through it. On Postgres the outer `db` is a *pool*, so a statement sent to it
 * from inside here would take a different connection and land outside the
 * transaction — committed while the rest rolled back.
 *
 * An adapter with no `transaction` runs unwrapped. That is what a custom
 * adapter had before this existed; it is not a guarantee being dropped
 * quietly, it is one that was never available.
 *
 * Two caveats worth knowing, neither reachable from the migrations this
 * framework ships: Postgres refuses `CREATE INDEX CONCURRENTLY` and `VACUUM`
 * inside a transaction, and SQLite ignores `PRAGMA foreign_keys` there — the
 * table-rebuild pattern that relies on turning it off has to do so outside.
 *
 * @param {Object} db
 * @param {(tx: Object) => Promise<void>} work
 */
async function atomically(db, work) {
  if (typeof db.transaction !== 'function') return work(db)

  return db.transaction(work)
}

/**
 * Create migrations table if it doesn't exist
 */
async function ensureMigrationsTable(db) {
  const grammar = grammarFor(db)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${grammar.escapeId(MIGRATIONS_TABLE)} (
      id ${grammar.autoIncrementPrimaryKey()},
      migration TEXT NOT NULL UNIQUE,
      batch INTEGER NOT NULL,
      ran_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

/**
 * Get list of migration files
 */
function getMigrationFiles(dir) {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir)
    .filter(isModuleFile)
    .sort()
    .map(f => ({
      name: stripModuleExtension(f),
      path: join(dir, f)
    }))
}

/**
 * Get migrations that haven't been run
 */
async function getPendingMigrations(db, dir) {
  const files = getMigrationFiles(dir)
  const ran = await getRanMigrations(db)
  const ranSet = new Set(ran.map(m => m.migration))

  return files.filter(f => !ranSet.has(f.name))
}

/**
 * Get all ran migrations
 */
async function getRanMigrations(db) {
  return migrationsTable(db).orderBy('batch').orderBy('id').get()
}

/**
 * Get the highest batch number, or 0 if nothing has run.
 *
 * MAX() takes no parameters, so this one query is portable as written.
 */
async function getMaxBatch(db) {
  const table = grammarFor(db).escapeId(MIGRATIONS_TABLE)
  const result = await db.get(`SELECT MAX(batch) AS max FROM ${table}`)

  // Postgres returns null for an empty table; SQLite returns null too.
  return Number(result?.max) || 0
}

/**
 * Get next batch number
 */
async function getNextBatch(db) {
  return (await getMaxBatch(db)) + 1
}

/**
 * Get last batch number
 */
async function getLastBatch(db) {
  return (await getMaxBatch(db)) || null
}

/**
 * Get migrations by batch
 */
async function getMigrationsByBatch(db, batch) {
  return migrationsTable(db).where('batch', batch).orderBy('id').get()
}

/**
 * Record that a migration has run
 */
async function recordMigration(db, name, batch) {
  await migrationsTable(db).insert({ migration: name, batch })
}

/**
 * Remove migration record
 */
async function removeMigration(db, name) {
  await migrationsTable(db).where('migration', name).delete()
}

/**
 * Load migration module
 */
async function loadMigration(filePath) {
  const fileUrl = pathToFileURL(filePath).href
  return import(fileUrl)
}

/**
 * Find migration file by name
 */
function findMigrationFile(dir, name) {
  const files = getMigrationFiles(dir)
  const match = files.find(f => f.name === name)
  return match?.path || null
}

/**
 * Get all table names (for fresh command)
 */
async function getAllTables(db) {
  // Ask the driver we actually connected to. Probing SQLite's catalogue first
  // and falling back on error can't work: the SQLite adapter is synchronous, so
  // a failing query throws before there is a promise to catch.
  if (grammarFor(db).isPostgres()) {
    const tables = await db.all(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    )
    return tables.map(t => t.tablename)
  }

  const tables = await db.all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  )
  return tables.map(t => t.name)
}
