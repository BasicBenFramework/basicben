/**
 * TOTP tests.
 *
 * The RFC publishes test vectors for both HOTP (4226) and TOTP (6238), and they
 * are the only thing that actually settles whether an implementation is right.
 * Every other assertion here is about the parts the RFC does not cover: replay,
 * skew, encryption at rest, and the URI an authenticator imports.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import {
  generateSecret,
  totp,
  hotp,
  verifyTotp,
  otpauthUri,
  encryptSecret,
  decryptSecret
} from './totp.js'
import { encodeBase32, decodeBase32 } from './base32.js'

// The seed both RFCs use: the ASCII string "12345678901234567890".
const RFC_SECRET = encodeBase32(Buffer.from('12345678901234567890', 'ascii'))

describe('base32', () => {
  test('round-trips', () => {
    const bytes = Buffer.from('12345678901234567890', 'ascii')
    assert.ok(decodeBase32(encodeBase32(bytes)).equals(bytes))
  })

  test('matches the RFC 4648 vectors', () => {
    assert.strictEqual(encodeBase32(Buffer.from('')), '')
    assert.strictEqual(encodeBase32(Buffer.from('f')), 'MY')
    assert.strictEqual(encodeBase32(Buffer.from('fo')), 'MZXQ')
    assert.strictEqual(encodeBase32(Buffer.from('foo')), 'MZXW6')
    assert.strictEqual(encodeBase32(Buffer.from('foob')), 'MZXW6YQ')
    assert.strictEqual(encodeBase32(Buffer.from('fooba')), 'MZXW6YTB')
    assert.strictEqual(encodeBase32(Buffer.from('foobar')), 'MZXW6YTBOI')
  })

  test('tolerates what a person types', () => {
    const expected = decodeBase32('MZXW6YTBOI')

    assert.ok(decodeBase32('mzxw6ytboi').equals(expected), 'lowercase')
    assert.ok(decodeBase32('MZXW 6YTB OI').equals(expected), 'spaces')
    assert.ok(decodeBase32('MZXW-6YTB-OI').equals(expected), 'hyphens')
    assert.ok(decodeBase32('MZXW6YTBOI======').equals(expected), 'padding')
  })

  test('rejects a character outside the alphabet', () => {
    assert.throws(() => decodeBase32('MZXW6YTB!!'), /Invalid base32/)
    assert.throws(() => decodeBase32('01890'), /Invalid base32/)
  })
})

describe('HOTP — RFC 4226 test vectors', () => {
  const expected = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489'
  ]

  for (let counter = 0; counter < expected.length; counter++) {
    test(`counter ${counter} gives ${expected[counter]}`, () => {
      assert.strictEqual(hotp(RFC_SECRET, counter), expected[counter])
    })
  }
})

describe('TOTP — RFC 6238 test vectors', () => {
  // Appendix B, SHA-1 rows. Eight digits, which is what the RFC tabulates.
  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130']
  ]

  for (const [t, expected] of vectors) {
    test(`t=${t} gives ${expected}`, () => {
      assert.strictEqual(totp(RFC_SECRET, { t, digits: 8 }), expected)
    })
  }

  test('the same instant at six digits is the tail of the eight-digit code', () => {
    assert.strictEqual(totp(RFC_SECRET, { t: 59, digits: 8 }), '94287082')
    assert.strictEqual(totp(RFC_SECRET, { t: 59, digits: 6 }), '287082')
  })

  test('a code holds for its whole step and then changes', () => {
    const atStart = totp(RFC_SECRET, { t: 60 })
    const atEnd = totp(RFC_SECRET, { t: 89 })
    const next = totp(RFC_SECRET, { t: 90 })

    assert.strictEqual(atStart, atEnd)
    assert.notStrictEqual(atStart, next)
  })
})

describe('secrets', () => {
  test('generated secrets are base32 and unique', () => {
    const a = generateSecret()
    const b = generateSecret()

    assert.match(a, /^[A-Z2-7]+$/)
    assert.strictEqual(decodeBase32(a).length, 20)
    assert.notStrictEqual(a, b)
  })
})

describe('verification', () => {
  const now = 1700000000

  test('accepts the current code', () => {
    const code = totp(RFC_SECRET, { t: now })
    assert.deepStrictEqual(verifyTotp(RFC_SECRET, code, { t: now }).valid, true)
  })

  test('accepts one step either side, for clock skew', () => {
    const previous = totp(RFC_SECRET, { t: now - 30 })
    const next = totp(RFC_SECRET, { t: now + 30 })

    assert.strictEqual(verifyTotp(RFC_SECRET, previous, { t: now }).valid, true)
    assert.strictEqual(verifyTotp(RFC_SECRET, next, { t: now }).valid, true)
  })

  test('refuses two steps away', () => {
    const stale = totp(RFC_SECRET, { t: now - 90 })
    assert.strictEqual(verifyTotp(RFC_SECRET, stale, { t: now }).valid, false)
  })

  test('reports the step so the caller can record it', () => {
    const code = totp(RFC_SECRET, { t: now })
    assert.strictEqual(verifyTotp(RFC_SECRET, code, { t: now }).step, Math.floor(now / 30))
  })

  test('refuses a code from an already-used step', () => {
    const code = totp(RFC_SECRET, { t: now })
    const step = Math.floor(now / 30)

    const replay = verifyTotp(RFC_SECRET, code, { t: now, lastStep: step })

    assert.strictEqual(replay.valid, false)
    assert.strictEqual(replay.reason, 'replayed')
  })

  test('a used step also blocks the earlier code still inside the window', () => {
    // Without this, an intercepted code could be replayed for a further 30
    // seconds by submitting it one step late.
    const previous = totp(RFC_SECRET, { t: now - 30 })
    const result = verifyTotp(RFC_SECRET, previous, { t: now, lastStep: Math.floor(now / 30) })

    assert.strictEqual(result.valid, false)
    assert.strictEqual(result.reason, 'replayed')
  })

  test('the next step is accepted after one is used', () => {
    const step = Math.floor(now / 30)
    const next = totp(RFC_SECRET, { t: now + 30 })

    assert.strictEqual(verifyTotp(RFC_SECRET, next, { t: now + 30, lastStep: step }).valid, true)
  })

  test('rejects malformed input without touching the secret', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 56']) {
      const result = verifyTotp(RFC_SECRET, bad, { t: now })
      assert.strictEqual(result.valid, false, `expected ${JSON.stringify(bad)} to be refused`)
    }
  })

  test('accepts a code the user typed with a space', () => {
    const code = totp(RFC_SECRET, { t: now })
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`

    assert.strictEqual(verifyTotp(RFC_SECRET, spaced, { t: now }).valid, true)
  })

  test('a different secret does not verify', () => {
    const code = totp(RFC_SECRET, { t: now })
    assert.strictEqual(verifyTotp(generateSecret(), code, { t: now }).valid, false)
  })
})

describe('otpauth URI', () => {
  test('carries everything an authenticator needs', () => {
    const uri = otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', label: 'ada@example.com', issuer: 'BasicBen' })
    const url = new URL(uri)

    assert.strictEqual(url.protocol, 'otpauth:')
    assert.strictEqual(url.searchParams.get('secret'), 'JBSWY3DPEHPK3PXP')
    assert.strictEqual(url.searchParams.get('issuer'), 'BasicBen')
    assert.strictEqual(url.searchParams.get('algorithm'), 'SHA1')
    assert.strictEqual(url.searchParams.get('digits'), '6')
    assert.strictEqual(url.searchParams.get('period'), '30')
  })

  test('prefixes the label with the issuer, as apps expect', () => {
    const uri = otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', label: 'ada@example.com', issuer: 'BasicBen' })
    assert.ok(uri.includes('/BasicBen:ada%40example.com?'))
  })

  test('escapes an issuer containing a space', () => {
    const uri = otpauthUri({ secret: 'S', label: 'a@b.c', issuer: 'My Site' })
    assert.ok(uri.includes('/My%20Site:'))
    assert.strictEqual(new URL(uri).searchParams.get('issuer'), 'My Site')
  })

  test('requires a secret and a label', () => {
    assert.throws(() => otpauthUri({ label: 'a@b.c' }), /requires a secret/)
    assert.throws(() => otpauthUri({ secret: 'S' }), /requires a label/)
  })
})

describe('secret encryption', () => {
  const key = 'test-app-key-0123456789'

  test('round-trips', () => {
    const secret = generateSecret()
    assert.strictEqual(decryptSecret(encryptSecret(secret, key), key), secret)
  })

  test('the ciphertext does not contain the secret', () => {
    const secret = generateSecret()
    assert.ok(!encryptSecret(secret, key).includes(secret))
  })

  test('encrypting twice gives different ciphertext', () => {
    const secret = generateSecret()
    assert.notStrictEqual(encryptSecret(secret, key), encryptSecret(secret, key))
  })

  test('a different key cannot read it', () => {
    const encrypted = encryptSecret(generateSecret(), key)
    assert.strictEqual(decryptSecret(encrypted, 'another-key'), null)
  })

  test('tampering is detected rather than returning garbage', () => {
    const encrypted = encryptSecret(generateSecret(), key)
    const [iv, tag, payload] = encrypted.split(':')

    const flipped = Buffer.from(payload, 'base64')
    flipped[0] ^= 0xff

    assert.strictEqual(decryptSecret([iv, tag, flipped.toString('base64')].join(':'), key), null)
  })

  test('malformed input returns null rather than throwing', () => {
    for (const bad of ['', 'nonsense', 'a:b', null, undefined, 'a:b:c:d']) {
      assert.strictEqual(decryptSecret(bad, key), null)
    }
  })

  test('encrypting without a key is refused', () => {
    assert.throws(() => encryptSecret('SECRET', ''), /requires APP_KEY/)
  })

  test('a decrypted secret still produces valid codes', () => {
    const secret = generateSecret()
    const decrypted = decryptSecret(encryptSecret(secret, key), key)

    assert.strictEqual(totp(decrypted, { t: 1700000000 }), totp(secret, { t: 1700000000 }))
  })
})
