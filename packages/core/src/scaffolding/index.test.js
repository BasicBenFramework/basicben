/**
 * Tests for the scaffolding system
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { transformName, timestamp } from './index.js'

describe('transformName', () => {
  test('transforms simple name', () => {
    const result = transformName('user')

    assert.strictEqual(result.pascal, 'User')
    assert.strictEqual(result.camel, 'user')
    assert.strictEqual(result.snake, 'user')
    assert.strictEqual(result.kebab, 'user')
    assert.strictEqual(result.lower, 'user')
    assert.strictEqual(result.pluralLower, 'users')
  })

  test('transforms PascalCase name', () => {
    const result = transformName('UserProfile')

    assert.strictEqual(result.pascal, 'UserProfile')
    assert.strictEqual(result.camel, 'userProfile')
    assert.strictEqual(result.snake, 'user_profile')
    assert.strictEqual(result.kebab, 'user-profile')
  })

  test('handles Controller suffix', () => {
    const result = transformName('UserController')

    assert.strictEqual(result.pascal, 'User')
    assert.strictEqual(result.lower, 'user')
  })

  test('handles Model suffix', () => {
    const result = transformName('UserModel')

    assert.strictEqual(result.pascal, 'User')
  })

  test('pluralizes words ending in y', () => {
    const result = transformName('category')

    assert.strictEqual(result.pluralLower, 'categories')
  })

  test('pluralizes words ending in s', () => {
    const result = transformName('status')

    assert.strictEqual(result.pluralLower, 'statuses')
  })

  test('pluralizes words ending in ch', () => {
    const result = transformName('match')

    assert.strictEqual(result.pluralLower, 'matches')
  })
})

describe('timestamp', () => {
  test('generates 14-digit timestamp', () => {
    const ts = timestamp()

    assert.strictEqual(ts.length, 14)
    assert.match(ts, /^\d{14}$/)
  })

  test('starts with current year', () => {
    const ts = timestamp()
    const year = new Date().getFullYear().toString()

    assert.ok(ts.startsWith(year))
  })
})
