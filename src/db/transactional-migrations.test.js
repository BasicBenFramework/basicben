/**
 * A migration and the row saying it ran commit together, or neither does.
 *
 * Before this, a migration that threw halfway left whatever it had already done
 * behind, with no record of having run. The next `migrate` then failed on
 * "table already exists" and there was nothing to roll back, because the
 * bookkeeping never happened — the only way out was editing `_migrations` by
 * hand. That was hit for real while making Postgres work: a rollback died
 * between two `down` steps and left a database where the next migrate failed
 * with "column slug already exists".
 *
 * These run against a real SQLite file rather than a recording adapter. The
 * question is whether the database rolled back, and only a database can answer
 * it. The same scenarios run against Postgres in the smoke test.
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteAdapter } from './adapters/sqlite.js'
import { createMigrator } from './migrator.js'

let dir
let db

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'basicben-tx-'))
  db = await createSqliteAdapter(join(dir, 'test.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Write a migration file into a `migrations` subdirectory of the temp dir. */
function migration(name, source) {
  const path = join(dir, `${name}.js`)
  writeFileSync(path, source)
  return path
}

const tables = () =>
  db
    .all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .map((row) => row.name)

const recorded = () => db.all('SELECT migration FROM _migrations').map((row) => row.migration)

describe('a migration that fails halfway', () => {
  beforeEach(() => {
    migration(
      '2024_01_01_000000_two_tables',
      `export const up = async (db) => {
         await db.exec('CREATE TABLE first (id INTEGER PRIMARY KEY)')
         throw new Error('deliberate failure between two tables')
       }
       export const down = async () => {}`
    )
  })

  test('leaves nothing behind', async () => {
    const migrator = await createMigrator(dir, db)

    await assert.rejects(() => migrator.migrate(), /deliberate failure/)

    // The table it managed to create before throwing must be gone. This is the
    // whole point: without the transaction, `first` survives and every later
    // `migrate` dies on "table already exists".
    assert.ok(!tables().includes('first'), 'the half-created table survived the failure')
  })

  test('and records nothing as having run', async () => {
    const migrator = await createMigrator(dir, db)

    await assert.rejects(() => migrator.migrate())

    assert.deepStrictEqual(recorded(), [])
  })

  test('so creating that table afterwards still works', async () => {
    const migrator = await createMigrator(dir, db)

    await assert.rejects(() => migrator.migrate())

    // Before the fix this died on "table first already exists": the failed
    // migration had left it behind and nothing recorded that it ran, so the
    // database was in a state no migration described.
    //
    // A second file rather than a corrected version of the first, because ESM
    // caches modules by URL — rewriting a file and re-importing it in the same
    // process returns the old one. The CLI is a fresh process each run, so this
    // only shapes the test.
    rmSync(join(dir, '2024_01_01_000000_two_tables.js'))
    migration(
      '2024_01_02_000000_two_tables_fixed',
      `export const up = async (db) => {
         await db.exec('CREATE TABLE first (id INTEGER PRIMARY KEY)')
         await db.exec('CREATE TABLE second (id INTEGER PRIMARY KEY)')
       }
       export const down = async () => {}`
    )

    const retried = await createMigrator(dir, db)
    const result = await retried.migrate()

    assert.deepStrictEqual(result.ran, ['2024_01_02_000000_two_tables_fixed'])
    assert.ok(tables().includes('first') && tables().includes('second'))
  })
})

describe('a rollback that fails halfway', () => {
  test('leaves the schema and the bookkeeping as they were', async () => {
    migration(
      '2024_01_01_000000_create_things',
      `export const up = async (db) => {
         await db.exec('CREATE TABLE things (id INTEGER PRIMARY KEY)')
         await db.exec('CREATE TABLE parts (id INTEGER PRIMARY KEY)')
       }
       export const down = async (db) => {
         await db.exec('DROP TABLE parts')
         throw new Error('deliberate failure mid-rollback')
       }`
    )

    const migrator = await createMigrator(dir, db)
    await migrator.migrate()

    assert.ok(tables().includes('parts'))

    await assert.rejects(() => migrator.rollback(), /deliberate failure/)

    // `parts` was dropped before the throw; the transaction has to put it back,
    // or the database is in a state no migration describes.
    assert.ok(tables().includes('parts'), 'the dropped table was not restored')
    assert.ok(tables().includes('things'))

    // And the migration is still recorded as applied, matching the schema.
    assert.deepStrictEqual(recorded(), ['2024_01_01_000000_create_things'])
  })
})

describe('a migration that opens its own transaction', () => {
  test('still works, joining the one the runner opened', async () => {
    // Legal before migrations were wrapped, so it has to stay legal. SQLite
    // refuses a nested BEGIN outright, which is why the adapter counts depth
    // rather than issuing one.
    migration(
      '2024_01_01_000000_nested',
      `export const up = async (db) => {
         await db.transaction(async (tx) => {
           await tx.exec('CREATE TABLE nested (id INTEGER PRIMARY KEY)')
         })
       }
       export const down = async () => {}`
    )

    const migrator = await createMigrator(dir, db)
    const result = await migrator.migrate()

    assert.deepStrictEqual(result.ran, ['2024_01_01_000000_nested'])
    assert.ok(tables().includes('nested'))
  })

  test('and a failure inside it still unwinds everything', async () => {
    // There are no savepoints here, so the inner transaction cannot roll back
    // on its own — an inner failure has to take the whole migration with it.
    migration(
      '2024_01_01_000000_nested_failure',
      `export const up = async (db) => {
         await db.exec('CREATE TABLE outer_table (id INTEGER PRIMARY KEY)')
         await db.transaction(async (tx) => {
           await tx.exec('CREATE TABLE inner_table (id INTEGER PRIMARY KEY)')
           throw new Error('deliberate failure inside a nested transaction')
         })
       }
       export const down = async () => {}`
    )

    const migrator = await createMigrator(dir, db)

    await assert.rejects(() => migrator.migrate(), /deliberate failure/)

    assert.ok(!tables().includes('outer_table'), 'the outer table survived')
    assert.ok(!tables().includes('inner_table'), 'the inner table survived')
    assert.deepStrictEqual(recorded(), [])
  })
})

describe('a successful migration', () => {
  test('commits, so the next connection sees it', async () => {
    // The mirror of every test above: proving the failures roll back is
    // worthless if the successes never commit.
    migration(
      '2024_01_01_000000_committed',
      `export const up = async (db) => {
         await db.exec('CREATE TABLE committed (id INTEGER PRIMARY KEY)')
       }
       export const down = async () => {}`
    )

    const migrator = await createMigrator(dir, db)
    await migrator.migrate()

    db.close()
    db = await createSqliteAdapter(join(dir, 'test.db'))

    assert.ok(tables().includes('committed'))
    assert.deepStrictEqual(recorded(), ['2024_01_01_000000_committed'])
  })
})
