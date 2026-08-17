/**
 * Placeholder translation for the Postgres adapter.
 *
 * SQLite binds with `?`, Postgres with `$1`. The query builder already knows
 * the difference, but hand-written SQL does not, and the template's models are
 * full of it — so a Postgres app migrated cleanly and then failed on the first
 * query it ran. These are the cases where a naive find-and-replace would be
 * worse than no translation at all.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { toNumberedPlaceholders as convert } from './adapters/postgres.js'

describe('toNumberedPlaceholders', () => {
  test('numbers placeholders in order', () => {
    assert.strictEqual(
      convert('SELECT * FROM users WHERE id = ? AND role = ?'),
      'SELECT * FROM users WHERE id = $1 AND role = $2'
    )
  })

  test('handles an INSERT with many values', () => {
    assert.strictEqual(
      convert('INSERT INTO t (a, b, c) VALUES (?, ?, ?)'),
      'INSERT INTO t (a, b, c) VALUES ($1, $2, $3)'
    )
  })

  test('leaves SQL without placeholders alone', () => {
    const sql = 'SELECT count(*) FROM users'
    assert.strictEqual(convert(sql), sql)
  })

  test('leaves SQL that already uses $n alone', () => {
    // Query-builder output for Postgres arrives already numbered. Renumbering
    // would be silent corruption rather than an error.
    const sql = 'SELECT * FROM users WHERE id = $1'
    assert.strictEqual(convert(sql), sql)
  })

  test('ignores a ? inside a single-quoted string', () => {
    assert.strictEqual(
      convert("SELECT * FROM notes WHERE body = 'why?' AND id = ?"),
      "SELECT * FROM notes WHERE body = 'why?' AND id = $1"
    )
  })

  test('ignores a ? inside a double-quoted identifier', () => {
    assert.strictEqual(
      convert('SELECT "odd?column" FROM t WHERE id = ?'),
      'SELECT "odd?column" FROM t WHERE id = $1'
    )
  })

  test('survives an escaped quote inside a string', () => {
    // '' is one escaped quote, not the end of the literal followed by another.
    // Getting this wrong flips the parser into "outside a string" and renumbers
    // text that is data.
    assert.strictEqual(
      convert("SELECT * FROM t WHERE a = 'it''s a ? really' AND b = ?"),
      "SELECT * FROM t WHERE a = 'it''s a ? really' AND b = $1"
    )
  })

  test('leaves jsonb operators alone', () => {
    // Postgres spells key-existence ?, ?| and ?&. SQL written for Postgres on
    // purpose has to survive being handed to a Postgres adapter.
    assert.strictEqual(
      convert("SELECT * FROM t WHERE data ?| array['a','b'] AND id = ?"),
      "SELECT * FROM t WHERE data ?| array['a','b'] AND id = $1"
    )
    assert.strictEqual(
      convert('SELECT * FROM t WHERE data ?& x'),
      'SELECT * FROM t WHERE data ?& x'
    )
  })

  test('tolerates non-strings', () => {
    assert.strictEqual(convert(undefined), undefined)
    assert.strictEqual(convert(null), null)
  })

  test('the count matches what a caller would bind', () => {
    const sql = 'UPDATE t SET a = ?, b = ? WHERE id = ? AND owner = ?'
    const converted = convert(sql)

    assert.strictEqual(converted, 'UPDATE t SET a = $1, b = $2 WHERE id = $3 AND owner = $4')
    assert.strictEqual((sql.match(/\?/g) || []).length, 4)
    assert.strictEqual(Math.max(...[...converted.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))), 4)
  })
})
