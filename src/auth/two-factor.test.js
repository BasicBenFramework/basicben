/**
 * Recovery codes and attempt limiting.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  findRecoveryCode,
  normalizeCode,
  lockoutState,
  registerFailure,
  safeEquals,
  MAX_ATTEMPTS
} from './two-factor.js'

describe('recovery codes', () => {
  test('generates ten by default', () => {
    assert.strictEqual(generateRecoveryCodes().length, 10)
    assert.strictEqual(generateRecoveryCodes(3).length, 3)
  })

  test('are hyphenated and unambiguous to transcribe', () => {
    for (const code of generateRecoveryCodes()) {
      assert.match(code, /^[a-z2-9]{4}-[a-z2-9]{4}$/)
      // 0/O and 1/l/I are the pairs people get wrong reading from paper.
      assert.doesNotMatch(code, /[01lio]/)
    }
  })

  test('are not repeated', () => {
    const codes = generateRecoveryCodes(50)
    assert.strictEqual(new Set(codes).size, 50)
  })

  test('hash to something that does not contain the code', async () => {
    const [code] = generateRecoveryCodes(1)
    const [hash] = await hashRecoveryCodes([code])

    assert.ok(!hash.includes(code))
    assert.ok(!hash.includes(normalizeCode(code)))
  })

  test('a valid code is found by index', async () => {
    const codes = generateRecoveryCodes(5)
    const hashes = await hashRecoveryCodes(codes)

    assert.strictEqual(await findRecoveryCode(codes[2], hashes), 2)
    assert.strictEqual(await findRecoveryCode(codes[0], hashes), 0)
  })

  test('an unknown code is refused', async () => {
    const hashes = await hashRecoveryCodes(generateRecoveryCodes(3))
    assert.strictEqual(await findRecoveryCode('zzzz-zzzz', hashes), -1)
  })

  test('accepts the code however it was typed', async () => {
    const codes = generateRecoveryCodes(1)
    const hashes = await hashRecoveryCodes(codes)
    const [code] = codes

    assert.strictEqual(await findRecoveryCode(code.toUpperCase(), hashes), 0)
    assert.strictEqual(await findRecoveryCode(code.replace('-', ''), hashes), 0)
    assert.strictEqual(await findRecoveryCode(` ${code} `, hashes), 0)
  })

  test('empty input is refused rather than matching anything', async () => {
    const hashes = await hashRecoveryCodes(generateRecoveryCodes(3))

    for (const bad of ['', null, undefined, '   ', '-']) {
      assert.strictEqual(await findRecoveryCode(bad, hashes), -1)
    }
  })

  test('no stored codes means nothing verifies', async () => {
    assert.strictEqual(await findRecoveryCode('abcd-efgh', []), -1)
    assert.strictEqual(await findRecoveryCode('abcd-efgh', undefined), -1)
  })
})

describe('lockout', () => {
  const now = 1700000000000

  test('an untouched record is not locked', () => {
    assert.strictEqual(lockoutState({}, now).locked, false)
    assert.strictEqual(lockoutState({ locked_until: null }, now).locked, false)
  })

  test('a future lock reports how long is left', () => {
    const state = lockoutState({ locked_until: new Date(now + 60_000).toISOString() }, now)

    assert.strictEqual(state.locked, true)
    assert.strictEqual(state.retryAfter, 60)
  })

  test('an expired lock has lapsed', () => {
    const state = lockoutState({ locked_until: new Date(now - 1000).toISOString() }, now)
    assert.strictEqual(state.locked, false)
  })
})

describe('attempt counting', () => {
  test('counts up without locking below the limit', () => {
    const result = registerFailure({ failed_attempts: 0 })

    assert.strictEqual(result.failedAttempts, 1)
    assert.strictEqual(result.locked, false)
    assert.strictEqual(result.lockedUntil, null)
  })

  test('locks on the last allowed failure', () => {
    const result = registerFailure({ failed_attempts: MAX_ATTEMPTS - 1 })

    assert.strictEqual(result.locked, true)
    assert.ok(result.lockedUntil)
    assert.ok(new Date(result.lockedUntil) > new Date())
  })

  test('the counter resets when the lock is set, so it does not lock instantly again', () => {
    const result = registerFailure({ failed_attempts: MAX_ATTEMPTS - 1 })
    assert.strictEqual(result.failedAttempts, 0)
  })

  test('the limit is configurable', () => {
    assert.strictEqual(registerFailure({ failed_attempts: 1 }, { maxAttempts: 2 }).locked, true)
    assert.strictEqual(registerFailure({ failed_attempts: 1 }, { maxAttempts: 99 }).locked, false)
  })

  test('a six-digit code is only as strong as this limit', () => {
    // Five tries against 10^6 possibilities is the whole security argument for
    // a short numeric code; if this ever stops locking, TOTP is brute-forceable.
    let record = { failed_attempts: 0 }
    let locked = false

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const result = registerFailure(record)
      record = { failed_attempts: result.failedAttempts }
      locked = result.locked
    }

    assert.strictEqual(locked, true)
  })
})

describe('safeEquals', () => {
  test('matches equal strings', () => {
    assert.strictEqual(safeEquals('abc123', 'abc123'), true)
  })

  test('rejects different strings and lengths', () => {
    assert.strictEqual(safeEquals('abc123', 'abc124'), false)
    assert.strictEqual(safeEquals('abc', 'abcdef'), false)
  })

  test('handles null without throwing', () => {
    assert.strictEqual(safeEquals(null, 'x'), false)
    assert.strictEqual(safeEquals(undefined, undefined), true)
  })
})
