/**
 * Tests for the core validate function
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { validate, rules } from './index.js'

describe('validate', () => {
  test('passes with valid data', async () => {
    const result = await validate(
      { email: 'test@example.com' },
      { email: [rules.required, rules.email] }
    )

    assert.ok(result.passes())
    assert.ok(!result.fails())
  })

  test('fails with invalid data', async () => {
    const result = await validate(
      { email: 'not-an-email' },
      { email: [rules.required, rules.email] }
    )

    assert.ok(result.fails())
    assert.ok(!result.passes())
  })

  test('returns errors object', async () => {
    const result = await validate(
      { email: '' },
      { email: [rules.required] }
    )

    assert.ok(result.errors.email)
    assert.strictEqual(result.errors.email[0], 'email is required')
  })

  test('first() returns first error', async () => {
    const result = await validate(
      { email: '' },
      { email: [rules.required, rules.email] }
    )

    assert.strictEqual(result.first('email'), 'email is required')
  })

  test('all() returns flat array', async () => {
    const result = await validate(
      { email: '', name: '' },
      {
        email: [rules.required],
        name: [rules.required]
      }
    )

    const all = result.all()
    assert.strictEqual(all.length, 2)
    assert.ok(all.some(e => e.field === 'email'))
    assert.ok(all.some(e => e.field === 'name'))
  })

  test('validates multiple fields', async () => {
    const result = await validate(
      { email: 'test@example.com', name: 'Alice', age: 25 },
      {
        email: [rules.required, rules.email],
        name: [rules.required, rules.string],
        age: [rules.required, rules.integer]
      }
    )

    assert.ok(result.passes())
  })

  test('stops on first error per field', async () => {
    const result = await validate(
      { email: '' },
      { email: [rules.required, rules.email, rules.min(5)] }
    )

    // Should only have the "required" error, not email or min
    assert.strictEqual(result.errors.email.length, 1)
    assert.strictEqual(result.first('email'), 'email is required')
  })
})
