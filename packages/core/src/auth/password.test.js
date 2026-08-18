import { test, describe } from 'node:test'
import assert from 'node:assert'
import { hashPassword, verifyPassword, needsRehash } from './password.js'

describe('hashPassword', () => {
  test('creates hash with salt and params', async () => {
    const hash = await hashPassword('password123')

    assert.ok(hash)
    const parts = hash.split(':')
    assert.strictEqual(parts.length, 6) // salt:hash:N:r:p:keylen
  })

  test('creates unique hashes for same password', async () => {
    const hash1 = await hashPassword('password123')
    const hash2 = await hashPassword('password123')

    assert.notStrictEqual(hash1, hash2) // Different salts
  })

  test('respects custom options', async () => {
    const hash = await hashPassword('password123', {
      cost: 1024,
      blockSize: 8,
      parallelization: 1,
      keyLength: 32
    })

    const parts = hash.split(':')
    assert.strictEqual(parts[2], '1024') // cost
    assert.strictEqual(parts[5], '32')   // keyLength
  })
})

describe('verifyPassword', () => {
  test('verifies correct password', async () => {
    const hash = await hashPassword('mysecret')
    const isValid = await verifyPassword('mysecret', hash)

    assert.strictEqual(isValid, true)
  })

  test('rejects incorrect password', async () => {
    const hash = await hashPassword('mysecret')
    const isValid = await verifyPassword('wrongpassword', hash)

    assert.strictEqual(isValid, false)
  })

  test('returns false for empty password', async () => {
    const hash = await hashPassword('mysecret')
    const isValid = await verifyPassword('', hash)

    assert.strictEqual(isValid, false)
  })

  test('returns false for null password', async () => {
    const hash = await hashPassword('mysecret')
    const isValid = await verifyPassword(null, hash)

    assert.strictEqual(isValid, false)
  })

  test('returns false for malformed hash', async () => {
    const isValid = await verifyPassword('password', 'notavalidhash')

    assert.strictEqual(isValid, false)
  })

  test('returns false for empty hash', async () => {
    const isValid = await verifyPassword('password', '')

    assert.strictEqual(isValid, false)
  })

  test('handles hashes with custom params', async () => {
    const hash = await hashPassword('password', { cost: 1024, keyLength: 32 })
    const isValid = await verifyPassword('password', hash)

    assert.strictEqual(isValid, true)
  })
})

describe('needsRehash', () => {
  test('returns false when params match defaults', async () => {
    const hash = await hashPassword('password')
    const needs = needsRehash(hash)

    assert.strictEqual(needs, false)
  })

  test('returns true when cost differs', async () => {
    const hash = await hashPassword('password', { cost: 1024 })
    const needs = needsRehash(hash, { cost: 16384 })

    assert.strictEqual(needs, true)
  })

  test('returns true for malformed hash', () => {
    const needs = needsRehash('invalid')

    assert.strictEqual(needs, true)
  })

  test('returns true when keyLength differs', async () => {
    const hash = await hashPassword('password', { keyLength: 32 })
    const needs = needsRehash(hash, { keyLength: 64 })

    assert.strictEqual(needs, true)
  })
})
