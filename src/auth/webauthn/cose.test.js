/**
 * COSE → SPKI tests.
 *
 * These do not take the conversion on trust. Node generates a real key pair and
 * exports the public key as SPKI itself; the COSE map is built from the same
 * key's JWK coordinates, and this implementation must reproduce Node's bytes
 * exactly. Node is the oracle, so a shared misreading of the spec cannot hide
 * here — that is the whole point.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { generateKeyPairSync, createSign, createVerify } from 'node:crypto'
import { coseToSpki, coseToPublicKey, ALG, KTY, CRV } from './cose.js'

/** A COSE EC2 key built from the same key Node just generated. */
function coseFromEcKey(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' })

  return new Map([
    [1, KTY.EC2],
    [3, ALG.ES256],
    [-1, CRV.P256],
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')]
  ])
}

function coseFromRsaKey(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' })

  return new Map([
    [1, KTY.RSA],
    [3, ALG.RS256],
    [-1, Buffer.from(jwk.n, 'base64url')],
    [-2, Buffer.from(jwk.e, 'base64url')]
  ])
}

describe('ES256', () => {
  test('produces exactly the SPKI Node produces', () => {
    for (let i = 0; i < 20; i++) {
      const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })

      const expected = publicKey.export({ format: 'der', type: 'spki' })
      const { spki } = coseToSpki(coseFromEcKey(publicKey))

      assert.ok(
        spki.equals(expected),
        `run ${i}: expected ${expected.toString('hex')}, got ${spki.toString('hex')}`
      )
    }
  })

  test('the converted key verifies a real signature', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const message = Buffer.from('authenticator data + client data hash')

    const signature = createSign('SHA256').update(message).sign(privateKey)

    const { key } = coseToPublicKey(coseFromEcKey(publicKey))
    assert.ok(createVerify('SHA256').update(message).verify(key, signature))
  })

  test('a signature over different data does not verify', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })

    const signature = createSign('SHA256').update(Buffer.from('one thing')).sign(privateKey)
    const { key } = coseToPublicKey(coseFromEcKey(publicKey))

    assert.strictEqual(
      createVerify('SHA256').update(Buffer.from('another thing')).verify(key, signature),
      false
    )
  })

  test('a signature from a different key does not verify', () => {
    const a = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const b = generateKeyPairSync('ec', { namedCurve: 'P-256' })

    const signature = createSign('SHA256').update(Buffer.from('data')).sign(a.privateKey)
    const { key } = coseToPublicKey(coseFromEcKey(b.publicKey))

    assert.strictEqual(createVerify('SHA256').update(Buffer.from('data')).verify(key, signature), false)
  })

  test('a coordinate that is not 32 bytes is refused', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const cose = coseFromEcKey(publicKey)

    cose.set(-2, cose.get(-2).subarray(0, 31))

    assert.throws(() => coseToSpki(cose), /must be 32 bytes/)
  })

  test('a missing coordinate is refused', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const cose = coseFromEcKey(publicKey)

    cose.delete(-3)

    assert.throws(() => coseToSpki(cose), /missing its x or y/)
  })

  test('a curve other than P-256 is refused', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const cose = coseFromEcKey(publicKey)

    cose.set(-1, 2) // P-384

    assert.throws(() => coseToSpki(cose), /Unsupported COSE curve/)
  })
})

describe('RS256', () => {
  test('produces exactly the SPKI Node produces', () => {
    for (const modulusLength of [2048, 3072]) {
      const { publicKey } = generateKeyPairSync('rsa', { modulusLength })

      const expected = publicKey.export({ format: 'der', type: 'spki' })
      const { spki } = coseToSpki(coseFromRsaKey(publicKey))

      assert.ok(spki.equals(expected), `${modulusLength}-bit key did not round-trip`)
    }
  })

  test('the converted key verifies a real signature', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const message = Buffer.from('signed bytes')

    const signature = createSign('SHA256').update(message).sign(privateKey)

    const { key } = coseToPublicKey(coseFromRsaKey(publicKey))
    assert.ok(createVerify('SHA256').update(message).verify(key, signature))
  })

  test('a missing modulus is refused', () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const cose = coseFromRsaKey(publicKey)

    cose.delete(-1)

    assert.throws(() => coseToSpki(cose), /missing its modulus/)
  })
})

describe('rejected inputs', () => {
  test('an unsupported key type', () => {
    assert.throws(() => coseToSpki(new Map([[1, 1], [3, -8]])), /Unsupported COSE key type/)
  })

  test('an EC2 key claiming an algorithm it cannot use', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const cose = coseFromEcKey(publicKey)

    cose.set(3, ALG.RS256)

    assert.throws(() => coseToSpki(cose), /Unsupported COSE algorithm/)
  })

  test('EdDSA is refused rather than mishandled', () => {
    assert.throws(() => coseToSpki(new Map([[1, 1], [3, -8]])), /Unsupported/)
  })

  test('something that is not a map', () => {
    assert.throws(() => coseToSpki({ 1: 2 }), /must be a CBOR map/)
    assert.throws(() => coseToSpki(null), /must be a CBOR map/)
  })
})
