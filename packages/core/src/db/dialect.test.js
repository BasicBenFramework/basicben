/**
 * Dialect-specific SQL generation.
 *
 * These assert on generated SQL rather than executing, so the Postgres paths can
 * be covered without a Postgres server. Every bug covered here is invisible on
 * SQLite, where placeholders are '?' and the migrations table's DDL is the one
 * that was hand-written.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryBuilder } from './QueryBuilder.js'
import { createMigrator } from './migrator.js'

/** Records what would have been sent to the driver */
function recordingDb() {
  const calls = []
  return {
    calls,
    run(sql, params) { calls.push({ sql, params }); return { lastInsertRowid: 1, changes: 1 } },
    get(sql, params) { calls.push({ sql, params }); return undefined },
    all(sql, params) { calls.push({ sql, params }); return [] }
  }
}

describe('Postgres placeholder numbering', () => {
  test('skips no numbers when whereNull is mixed with where', () => {
    const qb = new QueryBuilder(recordingDb(), 'posts', 'postgres')
    qb.where('status', 'published').whereNull('deleted_at').where('author_id', 7)

    const sql = qb.toSql()

    // Two bound values, so the placeholders must be $1 and $2 — numbering by
    // position in the where list would emit $1 and $3 and leave $3 unbound.
    assert.match(sql, /\$1/)
    assert.match(sql, /\$2/)
    assert.doesNotMatch(sql, /\$3/)
    assert.strictEqual(qb.getParams().length, 2)
  })

  test('placeholder count matches param count', () => {
    const qb = new QueryBuilder(recordingDb(), 'posts', 'postgres')
    qb.whereNull('deleted_at').where('status', 'published').whereNotNull('published_at')

    const sql = qb.toSql()
    const placeholders = (sql.match(/\$\d+/g) || []).length

    assert.strictEqual(placeholders, qb.getParams().length)
  })

  test('UPDATE numbers where-clauses after the SET values', async () => {
    const db = recordingDb()
    const qb = new QueryBuilder(db, 'posts', 'postgres')
    qb.whereNull('deleted_at').where('id', 3)

    await qb.update({ title: 'new', body: 'text' })

    const { sql, params } = db.calls[0]
    const placeholders = (sql.match(/\$\d+/g) || []).length

    assert.strictEqual(placeholders, params.length)
    assert.match(sql, /\$3/)          // two SET values, then the bound where
    assert.doesNotMatch(sql, /\$4/)
  })

  test('SQLite is unaffected', () => {
    const qb = new QueryBuilder(recordingDb(), 'posts', 'sqlite')
    qb.where('status', 'published').whereNull('deleted_at')

    const sql = qb.toSql()

    assert.match(sql, /\?/)
    assert.doesNotMatch(sql, /\$\d/)
  })
})

describe('INSERT ... RETURNING', () => {
  test('Postgres inserts return the new id', async () => {
    const db = recordingDb()
    await new QueryBuilder(db, 'users', 'postgres').insert({ name: 'Ada' })

    assert.match(db.calls[0].sql, /RETURNING id$/)
  })

  test('SQLite inserts omit RETURNING', async () => {
    const db = recordingDb()
    await new QueryBuilder(db, 'users', 'sqlite').insert({ name: 'Ada' })

    assert.doesNotMatch(db.calls[0].sql, /RETURNING/)
  })
})

/**
 * Stands in for a connected adapter, recording every statement the migration
 * runner sends.
 *
 * @param {string} driver - Driver the runner reads its dialect from
 * @param {Object} [seed] - What the runner's own queries should see:
 *   `row` for get(), `rows` for all()
 */
function recordingAdapter(driver, { rows = [], row = undefined } = {}) {
  const calls = []
  return {
    driver,
    calls,
    statements: () => calls.map(c => c.sql),
    exec(sql) { calls.push({ sql, params: [] }) },
    run(sql, params = []) { calls.push({ sql, params }); return { lastInsertRowid: 1, changes: 1 } },
    get(sql, params = []) { calls.push({ sql, params }); return row },
    all(sql, params = []) { calls.push({ sql, params }); return rows }
  }
}

describe('Migration runner bookkeeping', () => {
  const MIGRATION = '2024_01_01_000000_create_things'
  let dir

  before(() => {
    // The migration itself touches nothing, so every statement recorded below
    // is one the runner issued on its own behalf.
    dir = mkdtempSync(join(tmpdir(), 'basicben-migrations-'))
    writeFileSync(
      join(dir, `${MIGRATION}.js`),
      'export const up = async () => {}\nexport const down = async () => {}\n'
    )
  })

  after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const createTable = db => db.statements().find(sql => sql.includes('CREATE TABLE'))

  test('Postgres gets a migrations table it can actually create', async () => {
    const db = recordingAdapter('postgres')
    await createMigrator(dir, db)

    const ddl = createTable(db)

    assert.match(ddl, /SERIAL PRIMARY KEY/)
    assert.match(ddl, /ran_at TIMESTAMP/)
    // Postgres rejects both of the SQLite spellings outright
    assert.doesNotMatch(ddl, /AUTOINCREMENT/)
    assert.doesNotMatch(ddl, /DATETIME/)
  })

  test('SQLite keeps its own spelling', async () => {
    const db = recordingAdapter('sqlite')
    await createMigrator(dir, db)

    const ddl = createTable(db)

    assert.match(ddl, /INTEGER PRIMARY KEY AUTOINCREMENT/)
    assert.match(ddl, /ran_at DATETIME/)
    assert.doesNotMatch(ddl, /SERIAL/)
  })

  test('recording a migration binds $1, $2 on Postgres', async () => {
    const db = recordingAdapter('postgres', { row: { max: 0 } })
    const migrator = await createMigrator(dir, db)

    await migrator.migrate()

    const insert = db.calls.find(c => c.sql.startsWith('INSERT'))
    assert.match(insert.sql, /VALUES \(\$1, \$2\)/)
    assert.deepStrictEqual(insert.params, [MIGRATION, 1])
  })

  test('the same insert binds ? on SQLite', async () => {
    const db = recordingAdapter('sqlite', { row: { max: 0 } })
    const migrator = await createMigrator(dir, db)

    await migrator.migrate()

    const insert = db.calls.find(c => c.sql.startsWith('INSERT'))
    assert.match(insert.sql, /VALUES \(\?, \?\)/)
    assert.deepStrictEqual(insert.params, [MIGRATION, 1])
  })

  test('rollback selects the batch and deletes the record by number', async () => {
    const db = recordingAdapter('postgres', {
      row: { max: 3 },
      rows: [{ id: 1, migration: MIGRATION, batch: 3 }]
    })
    const migrator = await createMigrator(dir, db)

    const result = await migrator.rollback()

    assert.deepStrictEqual(result.rolledBack, [MIGRATION])

    const select = db.calls.find(c => c.sql.startsWith('SELECT') && c.sql.includes('WHERE'))
    assert.match(select.sql, /WHERE "batch" = \$1/)
    assert.deepStrictEqual(select.params, [3])

    const remove = db.calls.find(c => c.sql.startsWith('DELETE'))
    assert.match(remove.sql, /WHERE "migration" = \$1/)
    assert.deepStrictEqual(remove.params, [MIGRATION])
  })

  test('no Postgres statement is left half-numbered or half-bound', async () => {
    const db = recordingAdapter('postgres', { row: { max: 0 } })
    const migrator = await createMigrator(dir, db)

    await migrator.migrate()
    await migrator.status()

    for (const { sql, params } of db.calls) {
      assert.doesNotMatch(sql, /\?/, `SQLite placeholder reached Postgres: ${sql}`)

      const numbered = new Set(sql.match(/\$\d+/g) || [])
      assert.strictEqual(numbered.size, params.length, `placeholders vs params: ${sql}`)
    }
  })

  test('fresh drops with CASCADE on Postgres', async () => {
    const db = recordingAdapter('postgres', { rows: [{ tablename: 'posts' }] })
    const migrator = await createMigrator(dir, db)

    await migrator.fresh()

    // A blind sweep hits parents before children as often as not
    assert.ok(db.statements().includes('DROP TABLE IF EXISTS "posts" CASCADE'))
    assert.ok(!db.statements().some(sql => sql.startsWith('PRAGMA')))
  })

  test('fresh suspends foreign keys on SQLite, which has no CASCADE', async () => {
    const db = recordingAdapter('sqlite', { rows: [{ name: 'posts' }] })
    const migrator = await createMigrator(dir, db)

    await migrator.fresh()

    const statements = db.statements()
    const drop = statements.findIndex(sql => sql.startsWith('DROP TABLE'))
    const off = statements.indexOf('PRAGMA foreign_keys = OFF')
    const on = statements.indexOf('PRAGMA foreign_keys = ON')

    assert.ok(drop !== -1, 'the sweep must issue a DROP')
    assert.doesNotMatch(statements[drop], /CASCADE/)
    assert.ok(off !== -1, 'constraints must come off before the sweep')
    assert.ok(on !== -1, 'and go back on after it')
    assert.ok(off < drop && drop < on, `expected OFF, DROP, ON in order: ${statements}`)
  })
})
