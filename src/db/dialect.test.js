/**
 * Dialect-specific SQL generation.
 *
 * These assert on generated SQL rather than executing, so the Postgres paths can
 * be covered without a Postgres server. Both bugs covered here are invisible on
 * SQLite, where every placeholder is '?'.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { QueryBuilder } from './QueryBuilder.js'

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
