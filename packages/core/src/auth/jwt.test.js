/**
 * Tests for JWT helpers
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { signJwt, verifyJwt, decodeJwt } from './jwt.js'

const SECRET = 'test-secret-key-12345'

describe('signJwt', () => {
  test('creates valid JWT token', () => {
    const token = signJwt({ userId: 1 }, SECRET)

    assert.ok(token)
    assert.strictEqual(token.split('.').length, 3)
  })

  test('includes payload in token', () => {
    const token = signJwt({ userId: 1, role: 'admin' }, SECRET)
    const decoded = decodeJwt(token)

    assert.strictEqual(decoded.userId, 1)
    assert.strictEqual(decoded.role, 'admin')
  })

  test('adds iat claim', () => {
    const before = Math.floor(Date.now() / 1000)
    const token = signJwt({ userId: 1 }, SECRET)
    const after = Math.floor(Date.now() / 1000)

    const decoded = decodeJwt(token)

    assert.ok(decoded.iat >= before)
    assert.ok(decoded.iat <= after)
  })

  test('adds exp claim with expiresIn', () => {
    const token = signJwt({ userId: 1 }, SECRET, { expiresIn: '1h' })
    const decoded = decodeJwt(token)

    const expectedExp = decoded.iat + 3600
    assert.strictEqual(decoded.exp, expectedExp)
  })

  test('throws without secret', () => {
    assert.throws(() => {
      signJwt({ userId: 1 }, null)
    }, /secret is required/)
  })
})

describe('verifyJwt', () => {
  test('verifies valid token', () => {
    const token = signJwt({ userId: 1 }, SECRET)
    const payload = verifyJwt(token, SECRET)

    assert.ok(payload)
    assert.strictEqual(payload.userId, 1)
  })

  test('returns null for invalid signature', () => {
    const token = signJwt({ userId: 1 }, SECRET)
    const payload = verifyJwt(token, 'wrong-secret')

    assert.strictEqual(payload, null)
  })

  test('returns null for tampered token', () => {
    const token = signJwt({ userId: 1 }, SECRET)
    const parts = token.split('.')

    // Tamper with payload
    const tamperedPayload = Buffer.from(JSON.stringify({ userId: 999 }))
      .toString('base64')
      .replace(/=/g, '')

    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`
    const payload = verifyJwt(tamperedToken, SECRET)

    assert.strictEqual(payload, null)
  })

  test('returns null for expired token', () => {
    const token = signJwt({ userId: 1 }, SECRET, { expiresIn: -1 })
    const payload = verifyJwt(token, SECRET)

    assert.strictEqual(payload, null)
  })

  test('returns null for malformed token', () => {
    assert.strictEqual(verifyJwt('not.a.valid.token', SECRET), null)
    assert.strictEqual(verifyJwt('invalid', SECRET), null)
    assert.strictEqual(verifyJwt('', SECRET), null)
    assert.strictEqual(verifyJwt(null, SECRET), null)
  })

  test('returns null without secret', () => {
    const token = signJwt({ userId: 1 }, SECRET)
    assert.strictEqual(verifyJwt(token, null), null)
  })
})

describe('decodeJwt', () => {
  test('decodes token without verification', () => {
    const token = signJwt({ userId: 1, role: 'admin' }, SECRET)
    const decoded = decodeJwt(token)

    assert.strictEqual(decoded.userId, 1)
    assert.strictEqual(decoded.role, 'admin')
  })

  test('returns null for malformed token', () => {
    assert.strictEqual(decodeJwt('invalid'), null)
    assert.strictEqual(decodeJwt(''), null)
    assert.strictEqual(decodeJwt(null), null)
  })
})

describe('expiry parsing', () => {
  test('handles seconds', () => {
    const token = signJwt({ userId: 1 }, SECRET, { expiresIn: '60s' })
    const decoded = decodeJwt(token)

    assert.strictEqual(decoded.exp - decoded.iat, 60)
  })

  test('handles minutes', () => {
    const token = signJwt({ userId: 1 }, SECRET, { expiresIn: '5m' })
    const decoded = decodeJwt(token)

    assert.strictEqual(decoded.exp - decoded.iat, 300)
  })

  test('handles hours', () => {
    const token = signJwt({ userId: 1 }, SECRET, { expiresIn: '2h' })
    const decoded = decodeJwt(token)

    assert.strictEqual(decoded.exp - decoded.iat, 7200)
  })

  test('handles days', () => {
    const token = signJwt({ userId: 1 }, SECRET, { expiresIn: '7d' })
    const decoded = decodeJwt(token)

    assert.strictEqual(decoded.exp - decoded.iat, 604800)
  })

  test('handles numeric seconds', () => {
    const token = signJwt({ userId: 1 }, SECRET, { expiresIn: 120 })
    const decoded = decodeJwt(token)

    assert.strictEqual(decoded.exp - decoded.iat, 120)
  })
})
