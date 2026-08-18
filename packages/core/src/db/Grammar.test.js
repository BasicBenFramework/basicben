/**
 * Tests for Grammar (SQL identifier escaping and validation)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { Grammar } from './Grammar.js'

describe('Grammar', () => {
  describe('validateId()', () => {
    test('accepts valid identifiers', () => {
      const grammar = new Grammar()

      assert.strictEqual(grammar.validateId('users'), 'users')
      assert.strictEqual(grammar.validateId('user_posts'), 'user_posts')
      assert.strictEqual(grammar.validateId('_private'), '_private')
      assert.strictEqual(grammar.validateId('Column1'), 'Column1')
      assert.strictEqual(grammar.validateId('camelCase'), 'camelCase')
    })

    test('rejects empty string', () => {
      const grammar = new Grammar()

      assert.throws(() => grammar.validateId(''), /non-empty string/)
    })

    test('rejects non-string', () => {
      const grammar = new Grammar()

      assert.throws(() => grammar.validateId(123), /non-empty string/)
      assert.throws(() => grammar.validateId(null), /non-empty string/)
      assert.throws(() => grammar.validateId(undefined), /non-empty string/)
    })

    test('rejects identifiers starting with number', () => {
      const grammar = new Grammar()

      assert.throws(() => grammar.validateId('1users'), /Invalid identifier/)
    })

    test('rejects SQL injection attempts', () => {
      const grammar = new Grammar()

      assert.throws(() => grammar.validateId('users; DROP TABLE'), /Invalid identifier/)
      assert.throws(() => grammar.validateId('id = 1; --'), /Invalid identifier/)
      assert.throws(() => grammar.validateId("name' OR '1'='1"), /Invalid identifier/)
      assert.throws(() => grammar.validateId('column"injection'), /Invalid identifier/)
    })

    test('rejects special characters', () => {
      const grammar = new Grammar()

      assert.throws(() => grammar.validateId('user-name'), /Invalid identifier/)
      assert.throws(() => grammar.validateId('user.name'), /Invalid identifier/)
      assert.throws(() => grammar.validateId('user name'), /Invalid identifier/)
      assert.throws(() => grammar.validateId('user@name'), /Invalid identifier/)
    })

    test('rejects very long identifiers', () => {
      const grammar = new Grammar()
      const longName = 'a'.repeat(200)

      assert.throws(() => grammar.validateId(longName), /too long/)
    })
  })

  describe('escapeId()', () => {
    test('wraps identifier in quotes', () => {
      const grammar = new Grammar()

      assert.strictEqual(grammar.escapeId('users'), '"users"')
      assert.strictEqual(grammar.escapeId('user_posts'), '"user_posts"')
    })

    test('validates before escaping', () => {
      const grammar = new Grammar()

      assert.throws(() => grammar.escapeId('bad; sql'), /Invalid identifier/)
    })
  })

  describe('placeholder()', () => {
    test('returns ? for sqlite', () => {
      const grammar = new Grammar('sqlite')

      assert.strictEqual(grammar.placeholder(0), '?')
      assert.strictEqual(grammar.placeholder(1), '?')
      assert.strictEqual(grammar.placeholder(5), '?')
    })

    test('returns $N for postgres', () => {
      const grammar = new Grammar('postgres')

      assert.strictEqual(grammar.placeholder(0), '$1')
      assert.strictEqual(grammar.placeholder(1), '$2')
      assert.strictEqual(grammar.placeholder(9), '$10')
    })
  })

  describe('validateOperator()', () => {
    test('accepts valid operators', () => {
      const grammar = new Grammar()

      assert.strictEqual(grammar.validateOperator('='), '=')
      assert.strictEqual(grammar.validateOperator('!='), '!=')
      assert.strictEqual(grammar.validateOperator('<>'), '<>')
      assert.strictEqual(grammar.validateOperator('<'), '<')
      assert.strictEqual(grammar.validateOperator('>'), '>')
      assert.strictEqual(grammar.validateOperator('<='), '<=')
      assert.strictEqual(grammar.validateOperator('>='), '>=')
      assert.strictEqual(grammar.validateOperator('LIKE'), 'LIKE')
      assert.strictEqual(grammar.validateOperator('like'), 'LIKE')
    })

    test('rejects invalid operators', () => {
      const grammar = new Grammar()

      assert.throws(() => grammar.validateOperator(';'), /Invalid operator/)
      assert.throws(() => grammar.validateOperator('DROP'), /Invalid operator/)
      assert.throws(() => grammar.validateOperator('||'), /Invalid operator/)
    })
  })

  describe('validateDirection()', () => {
    test('accepts ASC and DESC', () => {
      const grammar = new Grammar()

      assert.strictEqual(grammar.validateDirection('ASC'), 'ASC')
      assert.strictEqual(grammar.validateDirection('asc'), 'ASC')
      assert.strictEqual(grammar.validateDirection('DESC'), 'DESC')
      assert.strictEqual(grammar.validateDirection('desc'), 'DESC')
    })

    test('defaults to ASC', () => {
      const grammar = new Grammar()

      assert.strictEqual(grammar.validateDirection(), 'ASC')
      assert.strictEqual(grammar.validateDirection(null), 'ASC')
    })

    test('rejects invalid directions', () => {
      const grammar = new Grammar()

      assert.throws(() => grammar.validateDirection('RANDOM'), /Invalid sort direction/)
    })
  })

  describe('columnList()', () => {
    test('returns * for empty list', () => {
      const grammar = new Grammar()

      assert.strictEqual(grammar.columnList([]), '*')
      assert.strictEqual(grammar.columnList(null), '*')
    })

    test('preserves * in list', () => {
      const grammar = new Grammar()

      assert.strictEqual(grammar.columnList(['*']), '*')
    })

    test('escapes column names', () => {
      const grammar = new Grammar()

      assert.strictEqual(grammar.columnList(['id', 'name']), '"id", "name"')
    })
  })
})
