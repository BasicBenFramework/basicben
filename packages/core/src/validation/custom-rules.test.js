/**
 * Tests for custom validation rules
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { validate, rule } from './index.js'

describe('custom rules', () => {
  test('inline custom rule works', async () => {
    const noSpaces = (value, field) => {
      if (value && value.includes(' ')) {
        return `${field} must not contain spaces`
      }
      return null
    }

    const result = await validate(
      { username: 'has spaces' },
      { username: [noSpaces] }
    )

    assert.ok(result.fails())
    assert.strictEqual(result.first('username'), 'username must not contain spaces')
  })

  test('async custom rule works', async () => {
    const asyncRule = async (value) => {
      // Simulate async check (e.g., database lookup)
      await new Promise(r => setTimeout(r, 1))
      if (value === 'taken') {
        return 'This value is already taken'
      }
      return null
    }

    const result = await validate(
      { username: 'taken' },
      { username: [asyncRule] }
    )

    assert.ok(result.fails())
    assert.strictEqual(result.first('username'), 'This value is already taken')
  })

  test('async custom rule passes', async () => {
    const asyncRule = async (value) => {
      await new Promise(r => setTimeout(r, 1))
      if (value === 'taken') {
        return 'This value is already taken'
      }
      return null
    }

    const result = await validate(
      { username: 'available' },
      { username: [asyncRule] }
    )

    assert.ok(result.passes())
  })

  test('custom rule has access to all data', async () => {
    const passwordStrength = (value, field, data) => {
      // Password shouldn't contain username
      if (data.username && value.includes(data.username)) {
        return `${field} should not contain your username`
      }
      return null
    }

    const result = await validate(
      { username: 'alice', password: 'alice123' },
      { password: [passwordStrength] }
    )

    assert.ok(result.fails())
    assert.ok(result.first('password').includes('username'))
  })
})

describe('rule() helper', () => {
  test('creates custom rule with string message', async () => {
    const isPositive = rule(
      (value) => value > 0,
      'Value must be positive'
    )

    const result = await validate(
      { amount: -5 },
      { amount: [isPositive] }
    )

    assert.ok(result.fails())
    assert.strictEqual(result.first('amount'), 'Value must be positive')
  })

  test('creates custom rule with function message', async () => {
    const isPositive = rule(
      (value) => value > 0,
      (field, value) => `${field} must be positive, got ${value}`
    )

    const result = await validate(
      { amount: -5 },
      { amount: [isPositive] }
    )

    assert.ok(result.fails())
    assert.strictEqual(result.first('amount'), 'amount must be positive, got -5')
  })

  test('passes when validator returns true', async () => {
    const isPositive = rule(
      (value) => value > 0,
      'Value must be positive'
    )

    const result = await validate(
      { amount: 10 },
      { amount: [isPositive] }
    )

    assert.ok(result.passes())
  })

  test('async validator works', async () => {
    const isUnique = rule(
      async (value) => {
        await new Promise(r => setTimeout(r, 1))
        return value !== 'existing@email.com'
      },
      'Email already exists'
    )

    const result = await validate(
      { email: 'existing@email.com' },
      { email: [isUnique] }
    )

    assert.ok(result.fails())
    assert.strictEqual(result.first('email'), 'Email already exists')
  })
})

describe('combining custom and built-in rules', () => {
  test('custom rule runs after built-in rules', async () => {
    const { rules } = await import('./index.js')

    const noAdmin = (value) => {
      if (value === 'admin') {
        return 'Username "admin" is reserved'
      }
      return null
    }

    const result = await validate(
      { username: 'admin' },
      { username: [rules.required, rules.min(3), noAdmin] }
    )

    assert.ok(result.fails())
    assert.strictEqual(result.first('username'), 'Username "admin" is reserved')
  })

  test('built-in rule fails before custom rule runs', async () => {
    const { rules } = await import('./index.js')

    let customRuleCalled = false
    const noAdmin = () => {
      customRuleCalled = true
      return null
    }

    await validate(
      { username: 'ab' },
      { username: [rules.required, rules.min(3), noAdmin] }
    )

    // Custom rule should not be called because min(3) failed first
    assert.strictEqual(customRuleCalled, false)
  })
})
