/**
 * Tests for built-in validation rules
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { validate, rules } from './index.js'

describe('rules.required', () => {
  test('fails on empty string', async () => {
    const result = await validate({ name: '' }, { name: [rules.required] })
    assert.ok(result.fails())
  })

  test('fails on null', async () => {
    const result = await validate({ name: null }, { name: [rules.required] })
    assert.ok(result.fails())
  })

  test('fails on undefined', async () => {
    const result = await validate({}, { name: [rules.required] })
    assert.ok(result.fails())
  })

  test('passes on valid value', async () => {
    const result = await validate({ name: 'Alice' }, { name: [rules.required] })
    assert.ok(result.passes())
  })

  test('passes on zero', async () => {
    const result = await validate({ count: 0 }, { count: [rules.required] })
    assert.ok(result.passes())
  })

  test('passes on false', async () => {
    const result = await validate({ active: false }, { active: [rules.required] })
    assert.ok(result.passes())
  })
})

describe('rules.optional', () => {
  test('skips validation on empty value', async () => {
    const result = await validate(
      { email: '' },
      { email: [rules.optional, rules.email] }
    )
    assert.ok(result.passes())
  })

  test('skips validation on null', async () => {
    const result = await validate(
      { email: null },
      { email: [rules.optional, rules.email] }
    )
    assert.ok(result.passes())
  })

  test('skips validation on undefined', async () => {
    const result = await validate(
      {},
      { email: [rules.optional, rules.email] }
    )
    assert.ok(result.passes())
  })

  test('validates when value present', async () => {
    const result = await validate(
      { email: 'invalid' },
      { email: [rules.optional, rules.email] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.string', () => {
  test('passes on string', async () => {
    const result = await validate({ name: 'Alice' }, { name: [rules.string] })
    assert.ok(result.passes())
  })

  test('fails on number', async () => {
    const result = await validate({ name: 123 }, { name: [rules.string] })
    assert.ok(result.fails())
  })

  test('passes on empty string', async () => {
    const result = await validate({ name: '' }, { name: [rules.string] })
    assert.ok(result.passes())
  })
})

describe('rules.numeric', () => {
  test('passes on number', async () => {
    const result = await validate({ age: 25 }, { age: [rules.numeric] })
    assert.ok(result.passes())
  })

  test('passes on numeric string', async () => {
    const result = await validate({ age: '25' }, { age: [rules.numeric] })
    assert.ok(result.passes())
  })

  test('fails on non-numeric string', async () => {
    const result = await validate({ age: 'abc' }, { age: [rules.numeric] })
    assert.ok(result.fails())
  })
})

describe('rules.integer', () => {
  test('passes on integer', async () => {
    const result = await validate({ count: 10 }, { count: [rules.integer] })
    assert.ok(result.passes())
  })

  test('fails on float', async () => {
    const result = await validate({ count: 10.5 }, { count: [rules.integer] })
    assert.ok(result.fails())
  })

  test('passes on integer string', async () => {
    const result = await validate({ count: '10' }, { count: [rules.integer] })
    assert.ok(result.passes())
  })
})

describe('rules.boolean', () => {
  test('passes on true', async () => {
    const result = await validate({ active: true }, { active: [rules.boolean] })
    assert.ok(result.passes())
  })

  test('passes on false', async () => {
    const result = await validate({ active: false }, { active: [rules.boolean] })
    assert.ok(result.passes())
  })

  test('fails on string', async () => {
    const result = await validate({ active: 'true' }, { active: [rules.boolean] })
    assert.ok(result.fails())
  })
})

describe('rules.array', () => {
  test('passes on array', async () => {
    const result = await validate({ tags: ['a', 'b'] }, { tags: [rules.array] })
    assert.ok(result.passes())
  })

  test('passes on empty array', async () => {
    const result = await validate({ tags: [] }, { tags: [rules.array] })
    assert.ok(result.passes())
  })

  test('fails on object', async () => {
    const result = await validate({ tags: {} }, { tags: [rules.array] })
    assert.ok(result.fails())
  })
})

describe('rules.email', () => {
  test('passes valid email', async () => {
    const result = await validate(
      { email: 'test@example.com' },
      { email: [rules.email] }
    )
    assert.ok(result.passes())
  })

  test('passes email with subdomain', async () => {
    const result = await validate(
      { email: 'test@mail.example.com' },
      { email: [rules.email] }
    )
    assert.ok(result.passes())
  })

  test('fails invalid email', async () => {
    const result = await validate(
      { email: 'not-valid' },
      { email: [rules.email] }
    )
    assert.ok(result.fails())
  })

  test('fails email without domain', async () => {
    const result = await validate(
      { email: 'test@' },
      { email: [rules.email] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.url', () => {
  test('passes valid http url', async () => {
    const result = await validate(
      { website: 'http://example.com' },
      { website: [rules.url] }
    )
    assert.ok(result.passes())
  })

  test('passes valid https url', async () => {
    const result = await validate(
      { website: 'https://example.com/path?query=1' },
      { website: [rules.url] }
    )
    assert.ok(result.passes())
  })

  test('fails invalid url', async () => {
    const result = await validate(
      { website: 'not-a-url' },
      { website: [rules.url] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.min', () => {
  test('fails string shorter than min', async () => {
    const result = await validate(
      { password: '123' },
      { password: [rules.min(8)] }
    )
    assert.ok(result.fails())
    assert.ok(result.first('password').includes('at least 8'))
  })

  test('passes string at min length', async () => {
    const result = await validate(
      { password: '12345678' },
      { password: [rules.min(8)] }
    )
    assert.ok(result.passes())
  })

  test('passes string longer than min', async () => {
    const result = await validate(
      { password: '1234567890' },
      { password: [rules.min(8)] }
    )
    assert.ok(result.passes())
  })

  test('fails number below min', async () => {
    const result = await validate(
      { age: 5 },
      { age: [rules.min(18)] }
    )
    assert.ok(result.fails())
  })

  test('passes number at min', async () => {
    const result = await validate(
      { age: 18 },
      { age: [rules.min(18)] }
    )
    assert.ok(result.passes())
  })
})

describe('rules.max', () => {
  test('fails string longer than max', async () => {
    const result = await validate(
      { name: 'a'.repeat(101) },
      { name: [rules.max(100)] }
    )
    assert.ok(result.fails())
  })

  test('passes string at max length', async () => {
    const result = await validate(
      { name: 'a'.repeat(100) },
      { name: [rules.max(100)] }
    )
    assert.ok(result.passes())
  })

  test('passes string shorter than max', async () => {
    const result = await validate(
      { name: 'Alice' },
      { name: [rules.max(100)] }
    )
    assert.ok(result.passes())
  })

  test('fails number above max', async () => {
    const result = await validate(
      { age: 150 },
      { age: [rules.max(100)] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.between', () => {
  test('passes value in range', async () => {
    const result = await validate(
      { age: 25 },
      { age: [rules.between(18, 100)] }
    )
    assert.ok(result.passes())
  })

  test('passes value at min boundary', async () => {
    const result = await validate(
      { age: 18 },
      { age: [rules.between(18, 100)] }
    )
    assert.ok(result.passes())
  })

  test('passes value at max boundary', async () => {
    const result = await validate(
      { age: 100 },
      { age: [rules.between(18, 100)] }
    )
    assert.ok(result.passes())
  })

  test('fails value below range', async () => {
    const result = await validate(
      { age: 10 },
      { age: [rules.between(18, 100)] }
    )
    assert.ok(result.fails())
  })

  test('fails value above range', async () => {
    const result = await validate(
      { age: 150 },
      { age: [rules.between(18, 100)] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.in', () => {
  test('passes when value in list', async () => {
    const result = await validate(
      { role: 'admin' },
      { role: [rules.in('admin', 'user', 'guest')] }
    )
    assert.ok(result.passes())
  })

  test('fails when value not in list', async () => {
    const result = await validate(
      { role: 'superuser' },
      { role: [rules.in('admin', 'user', 'guest')] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.notIn', () => {
  test('passes when value not in list', async () => {
    const result = await validate(
      { status: 'active' },
      { status: [rules.notIn('banned', 'suspended')] }
    )
    assert.ok(result.passes())
  })

  test('fails when value in list', async () => {
    const result = await validate(
      { status: 'banned' },
      { status: [rules.notIn('banned', 'suspended')] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.regex', () => {
  test('passes when pattern matches', async () => {
    const result = await validate(
      { code: 'ABC123' },
      { code: [rules.regex(/^[A-Z]{3}\d{3}$/)] }
    )
    assert.ok(result.passes())
  })

  test('fails when pattern does not match', async () => {
    const result = await validate(
      { code: 'abc123' },
      { code: [rules.regex(/^[A-Z]{3}\d{3}$/)] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.confirmed', () => {
  test('passes when fields match', async () => {
    const result = await validate(
      { password: 'secret123', password_confirmation: 'secret123' },
      { password: [rules.confirmed()] }
    )
    assert.ok(result.passes())
  })

  test('fails when fields do not match', async () => {
    const result = await validate(
      { password: 'secret123', password_confirmation: 'different' },
      { password: [rules.confirmed()] }
    )
    assert.ok(result.fails())
  })

  test('works with custom confirmation field', async () => {
    const result = await validate(
      { password: 'secret123', confirm_password: 'secret123' },
      { password: [rules.confirmed('confirm_password')] }
    )
    assert.ok(result.passes())
  })
})

describe('rules.different', () => {
  test('passes when fields are different', async () => {
    const result = await validate(
      { password: 'new123', old_password: 'old456' },
      { password: [rules.different('old_password')] }
    )
    assert.ok(result.passes())
  })

  test('fails when fields are same', async () => {
    const result = await validate(
      { password: 'same123', old_password: 'same123' },
      { password: [rules.different('old_password')] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.length', () => {
  test('passes when exact length', async () => {
    const result = await validate(
      { code: '1234' },
      { code: [rules.length(4)] }
    )
    assert.ok(result.passes())
  })

  test('fails when shorter', async () => {
    const result = await validate(
      { code: '123' },
      { code: [rules.length(4)] }
    )
    assert.ok(result.fails())
  })

  test('fails when longer', async () => {
    const result = await validate(
      { code: '12345' },
      { code: [rules.length(4)] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.alpha', () => {
  test('passes on letters only', async () => {
    const result = await validate(
      { name: 'Alice' },
      { name: [rules.alpha] }
    )
    assert.ok(result.passes())
  })

  test('fails on numbers', async () => {
    const result = await validate(
      { name: 'Alice123' },
      { name: [rules.alpha] }
    )
    assert.ok(result.fails())
  })

  test('fails on spaces', async () => {
    const result = await validate(
      { name: 'Alice Bob' },
      { name: [rules.alpha] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.alphanumeric', () => {
  test('passes on letters and numbers', async () => {
    const result = await validate(
      { username: 'Alice123' },
      { username: [rules.alphanumeric] }
    )
    assert.ok(result.passes())
  })

  test('fails on special characters', async () => {
    const result = await validate(
      { username: 'Alice_123' },
      { username: [rules.alphanumeric] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.date', () => {
  test('passes valid date string', async () => {
    const result = await validate(
      { birthday: '2000-01-15' },
      { birthday: [rules.date] }
    )
    assert.ok(result.passes())
  })

  test('passes ISO date', async () => {
    const result = await validate(
      { created: '2024-01-15T10:30:00Z' },
      { created: [rules.date] }
    )
    assert.ok(result.passes())
  })

  test('fails invalid date', async () => {
    const result = await validate(
      { birthday: 'not-a-date' },
      { birthday: [rules.date] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.before', () => {
  test('passes when date is before', async () => {
    const result = await validate(
      { start: '2024-01-01' },
      { start: [rules.before('2024-12-31')] }
    )
    assert.ok(result.passes())
  })

  test('fails when date is after', async () => {
    const result = await validate(
      { start: '2025-01-01' },
      { start: [rules.before('2024-12-31')] }
    )
    assert.ok(result.fails())
  })

  test('fails when date is same', async () => {
    const result = await validate(
      { start: '2024-12-31' },
      { start: [rules.before('2024-12-31')] }
    )
    assert.ok(result.fails())
  })
})

describe('rules.after', () => {
  test('passes when date is after', async () => {
    const result = await validate(
      { end: '2025-01-01' },
      { end: [rules.after('2024-01-01')] }
    )
    assert.ok(result.passes())
  })

  test('fails when date is before', async () => {
    const result = await validate(
      { end: '2023-01-01' },
      { end: [rules.after('2024-01-01')] }
    )
    assert.ok(result.fails())
  })

  test('fails when date is same', async () => {
    const result = await validate(
      { end: '2024-01-01' },
      { end: [rules.after('2024-01-01')] }
    )
    assert.ok(result.fails())
  })
})
