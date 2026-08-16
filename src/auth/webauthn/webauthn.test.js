/**
 * WebAuthn verification tests.
 *
 * A virtual authenticator produces spec-conformant responses, which is what
 * Chrome's own testing authenticator does. It signs with node:crypto and encodes
 * CBOR with an encoder written for these tests — the opposite direction from the
 * decoder under test, so a decoder bug does not cancel out.
 *
 * **The negative tests are the point.** Accepting a valid assertion is easy;
 * every check that this refuses invalid input is a check that, if removed, is an
 * authentication bypass rather than a bug. There is one test per check, and each
 * fails loudly if the corresponding guard is deleted.
 *
 * A caveat worth stating plainly: a virtual authenticator tests this
 * implementation against this codebase's reading of the spec. The CBOR layer is
 * pinned to RFC 8949's published vectors and the COSE layer to Node's own key
 * export, which breaks the circularity for the two encoding layers. The ceremony
 * logic above them is not independently pinned, and fixtures recorded from real
 * hardware would be a genuine improvement.
 */

import { test, describe, before } from 'node:test'
import assert from 'node:assert'
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistration,
  verifyAuthentication
} from './index.js'
import { toBase64Url, fromBase64Url } from './parse.js'

// ---------------------------------------------------------------------------
// A minimal CBOR encoder, for building authenticator responses
// ---------------------------------------------------------------------------

function cborHead(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length])
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length])
  if (length < 0x10000) {
    const b = Buffer.alloc(3)
    b[0] = (major << 5) | 25
    b.writeUInt16BE(length, 1)
    return b
  }
  const b = Buffer.alloc(5)
  b[0] = (major << 5) | 26
  b.writeUInt32BE(length, 1)
  return b
}

function encodeCbor(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value])
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8')
    return Buffer.concat([cborHead(3, bytes.length), bytes])
  }
  if (typeof value === 'number') {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -value - 1)
  }
  if (Array.isArray(value)) {
    return Buffer.concat([cborHead(4, value.length), ...value.map(encodeCbor)])
  }
  if (value instanceof Map) {
    const parts = [cborHead(5, value.size)]
    for (const [k, v] of value) parts.push(encodeCbor(k), encodeCbor(v))
    return Buffer.concat(parts)
  }
  throw new Error(`Cannot encode ${typeof value}`)
}

// ---------------------------------------------------------------------------
// Virtual authenticator
// ---------------------------------------------------------------------------

const RP_ID = 'example.com'
const ORIGIN = 'https://example.com'

function createAuthenticator({ rpId = RP_ID } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const credentialId = randomBytes(32)
  const aaguid = randomBytes(16)
  let signCount = 0

  const jwk = publicKey.export({ format: 'jwk' })
  const coseKey = new Map([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')]
  ])

  function buildAuthData({ rpIdOverride, flags = 0x45, includeCredential, count }) {
    const rpIdHash = createHash('sha256').update(rpIdOverride ?? rpId, 'utf8').digest()
    const header = Buffer.alloc(5)
    header[0] = flags
    header.writeUInt32BE(count ?? signCount, 1)

    if (!includeCredential) {
      return Buffer.concat([rpIdHash, header])
    }

    const idLength = Buffer.alloc(2)
    idLength.writeUInt16BE(credentialId.length)

    return Buffer.concat([
      rpIdHash,
      header,
      aaguid,
      idLength,
      credentialId,
      encodeCbor(coseKey)
    ])
  }

  function clientDataJSON({ type, challenge, origin = ORIGIN }) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8')
  }

  return {
    credentialId,

    /** A `navigator.credentials.create()` response. */
    register({ challenge, rpIdOverride, flags = 0x45, origin, type = 'webauthn.create' } = {}) {
      const clientData = clientDataJSON({ type, challenge, origin })
      const authData = buildAuthData({ rpIdOverride, flags, includeCredential: true })

      const attestationObject = encodeCbor(new Map([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData]
      ]))

      return {
        id: toBase64Url(credentialId),
        rawId: toBase64Url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: toBase64Url(clientData),
          attestationObject: toBase64Url(attestationObject)
        }
      }
    },

    /** A `navigator.credentials.get()` response. */
    authenticate({
      challenge,
      rpIdOverride,
      flags = 0x05,
      origin,
      type = 'webauthn.get',
      count,
      tamperSignature = false,
      credentialIdOverride
    } = {}) {
      signCount += 1

      const clientData = clientDataJSON({ type, challenge, origin })
      const authData = buildAuthData({ rpIdOverride, flags, includeCredential: false, count })

      const base = Buffer.concat([authData, createHash('sha256').update(clientData).digest()])
      const signature = createSign('SHA256').update(base).sign(privateKey)

      if (tamperSignature) signature[signature.length - 1] ^= 0xff

      const id = toBase64Url(credentialIdOverride ?? credentialId)

      return {
        id,
        rawId: id,
        type: 'public-key',
        response: {
          clientDataJSON: toBase64Url(clientData),
          authenticatorData: toBase64Url(authData),
          signature: toBase64Url(signature)
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------

describe('option generation', () => {
  test('registration options carry a fresh 32-byte challenge', () => {
    const a = generateRegistrationOptions({ rpId: RP_ID, rpName: 'Example', user: { id: 1, name: 'ada' } })
    const b = generateRegistrationOptions({ rpId: RP_ID, rpName: 'Example', user: { id: 1, name: 'ada' } })

    assert.strictEqual(fromBase64Url(a.challenge).length, 32)
    assert.notStrictEqual(a.challenge, b.challenge)
  })

  test('registration asks for no attestation, since none is verified', () => {
    const { options } = generateRegistrationOptions({ rpId: RP_ID, rpName: 'X', user: { id: 1, name: 'a' } })
    assert.strictEqual(options.attestation, 'none')
  })

  test('registration offers ES256 and RS256', () => {
    const { options } = generateRegistrationOptions({ rpId: RP_ID, rpName: 'X', user: { id: 1, name: 'a' } })
    assert.deepStrictEqual(options.pubKeyCredParams.map((p) => p.alg), [-7, -257])
  })

  test('the user handle is not the raw database id', () => {
    const { options } = generateRegistrationOptions({
      rpId: RP_ID, rpName: 'X', user: { id: 42, handle: 'opaque-handle', name: 'a' }
    })
    assert.strictEqual(fromBase64Url(options.user.id).toString(), 'opaque-handle')
  })

  test('authentication options carry a fresh challenge', () => {
    const { challenge, options } = generateAuthenticationOptions({ rpId: RP_ID })

    assert.strictEqual(fromBase64Url(challenge).length, 32)
    assert.strictEqual(options.rpId, RP_ID)
  })

  test('rpId is required', () => {
    assert.throws(() => generateRegistrationOptions({ user: { id: 1, name: 'a' } }), /requires rpId/)
    assert.throws(() => generateAuthenticationOptions({}), /requires rpId/)
  })
})

describe('registration', () => {
  let authenticator
  let challenge

  before(() => {
    authenticator = createAuthenticator()
    challenge = toBase64Url(randomBytes(32))
  })

  test('accepts a well-formed response and returns the credential', () => {
    const result = verifyRegistration({
      response: authenticator.register({ challenge }),
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRpId: RP_ID
    })

    assert.strictEqual(result.credentialId, toBase64Url(authenticator.credentialId))
    assert.strictEqual(result.algorithm, -7)
    assert.ok(result.publicKey.length > 0)
    assert.strictEqual(result.attestationFormat, 'none')
  })

  test('the returned key is usable for verification afterwards', () => {
    const registered = verifyRegistration({
      response: authenticator.register({ challenge }),
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRpId: RP_ID
    })

    const next = toBase64Url(randomBytes(32))
    const result = verifyAuthentication({
      response: authenticator.authenticate({ challenge: next }),
      credential: registered,
      expectedChallenge: next,
      expectedOrigin: ORIGIN,
      expectedRpId: RP_ID
    })

    assert.strictEqual(result.verified, true)
  })

  test('accepts an array of allowed origins', () => {
    const result = verifyRegistration({
      response: authenticator.register({ challenge }),
      expectedChallenge: challenge,
      expectedOrigin: ['https://other.example', ORIGIN],
      expectedRpId: RP_ID
    })

    assert.ok(result.credentialId)
  })
})

describe('registration — each of these is a bypass if not checked', () => {
  const authenticator = createAuthenticator()
  const challenge = toBase64Url(randomBytes(32))

  const verify = (response, overrides = {}) => verifyRegistration({
    response,
    expectedChallenge: challenge,
    expectedOrigin: ORIGIN,
    expectedRpId: RP_ID,
    ...overrides
  })

  test('a different challenge is refused', () => {
    const response = authenticator.register({ challenge: toBase64Url(randomBytes(32)) })
    assert.throws(() => verify(response), /Challenge mismatch/)
  })

  test('a different origin is refused', () => {
    const response = authenticator.register({ challenge, origin: 'https://evil.example' })
    assert.throws(() => verify(response), /Origin .* is not allowed/)
  })

  test('a different RP ID is refused', () => {
    const response = authenticator.register({ challenge, rpIdOverride: 'evil.example' })
    assert.throws(() => verify(response), /RP ID hash mismatch/)
  })

  test('an authentication response cannot be replayed as a registration', () => {
    const response = authenticator.register({ challenge, type: 'webauthn.get' })
    assert.throws(() => verify(response), /Expected ceremony type "webauthn.create"/)
  })

  test('a response without user presence is refused', () => {
    // 0x40 keeps attested credential data but clears the user-present bit.
    const response = authenticator.register({ challenge, flags: 0x40 })
    assert.throws(() => verify(response), /User presence flag was not set/)
  })

  test('user verification is enforced when required', () => {
    // 0x41 is present-but-not-verified.
    const response = authenticator.register({ challenge, flags: 0x41 })

    assert.ok(verify(response), 'accepted when not required')
    assert.throws(() => verify(response, { requireUserVerification: true }), /User verification was required/)
  })

  test('a response carrying no credential is refused', () => {
    const response = authenticator.register({ challenge, flags: 0x05 }) // no AT bit
    assert.throws(() => verify(response), /carries no credential/)
  })

  test('a missing expected challenge or origin is an error, not a pass', () => {
    const response = authenticator.register({ challenge })

    assert.throws(() => verifyRegistration({
      response, expectedOrigin: ORIGIN, expectedRpId: RP_ID
    }), /expected challenge is required/)

    assert.throws(() => verifyRegistration({
      response, expectedChallenge: challenge, expectedRpId: RP_ID
    }), /expected origin is required/)

    assert.throws(() => verifyRegistration({
      response, expectedChallenge: challenge, expectedOrigin: ORIGIN
    }), /expected rpId is required/)
  })

  test('a malformed response is refused rather than throwing something unhelpful', () => {
    assert.throws(() => verify({ response: {} }), /missing clientDataJSON/)
    assert.throws(() => verify({}), /missing clientDataJSON/)
  })
})

describe('authentication', () => {
  let authenticator
  let credential

  before(() => {
    authenticator = createAuthenticator()
    const challenge = toBase64Url(randomBytes(32))
    credential = verifyRegistration({
      response: authenticator.register({ challenge }),
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRpId: RP_ID
    })
  })

  const verify = (response, challenge, overrides = {}) => verifyAuthentication({
    response,
    credential,
    expectedChallenge: challenge,
    expectedOrigin: ORIGIN,
    expectedRpId: RP_ID,
    ...overrides
  })

  test('accepts a well-formed assertion', () => {
    const challenge = toBase64Url(randomBytes(32))
    const result = verify(authenticator.authenticate({ challenge }), challenge)

    assert.strictEqual(result.verified, true)
    assert.strictEqual(typeof result.signCount, 'number')
  })

  test('a tampered signature is refused', () => {
    const challenge = toBase64Url(randomBytes(32))
    const response = authenticator.authenticate({ challenge, tamperSignature: true })

    assert.throws(() => verify(response, challenge), /Signature verification failed/)
  })

  test('a signature over a different challenge is refused', () => {
    const response = authenticator.authenticate({ challenge: toBase64Url(randomBytes(32)) })

    assert.throws(() => verify(response, toBase64Url(randomBytes(32))), /Challenge mismatch/)
  })

  test('a different origin is refused', () => {
    const challenge = toBase64Url(randomBytes(32))
    const response = authenticator.authenticate({ challenge, origin: 'https://evil.example' })

    assert.throws(() => verify(response, challenge), /Origin .* is not allowed/)
  })

  test('a different RP ID is refused', () => {
    const challenge = toBase64Url(randomBytes(32))
    const response = authenticator.authenticate({ challenge, rpIdOverride: 'evil.example' })

    assert.throws(() => verify(response, challenge), /RP ID hash mismatch/)
  })

  test('a registration response cannot be replayed as an authentication', () => {
    const challenge = toBase64Url(randomBytes(32))
    const response = authenticator.authenticate({ challenge, type: 'webauthn.create' })

    assert.throws(() => verify(response, challenge), /Expected ceremony type "webauthn.get"/)
  })

  test('an assertion without user presence is refused', () => {
    const challenge = toBase64Url(randomBytes(32))
    const response = authenticator.authenticate({ challenge, flags: 0x00 })

    assert.throws(() => verify(response, challenge), /User presence flag was not set/)
  })

  test('user verification is enforced when required', () => {
    const challenge = toBase64Url(randomBytes(32))
    const response = authenticator.authenticate({ challenge, flags: 0x01 })

    assert.ok(verify(response, challenge))
    assert.throws(
      () => verify(response, challenge, { requireUserVerification: true }),
      /User verification was required/
    )
  })

  test("another passkey's assertion is refused for this credential", () => {
    // The attacker holds a perfectly valid credential of their own — the check
    // that matters is that it is not the one being verified.
    const attacker = createAuthenticator()
    const challenge = toBase64Url(randomBytes(32))

    assert.throws(
      () => verify(attacker.authenticate({ challenge }), challenge),
      /not the credential being verified/
    )
  })

  test('claiming the right credential id while signing with another key is refused', () => {
    const attacker = createAuthenticator()
    const challenge = toBase64Url(randomBytes(32))

    // Same id as the real credential, but signed by the attacker's key.
    const response = attacker.authenticate({
      challenge,
      credentialIdOverride: fromBase64Url(credential.credentialId)
    })

    assert.throws(() => verify(response, challenge), /Signature verification failed/)
  })

  test('a stored credential is required', () => {
    const challenge = toBase64Url(randomBytes(32))
    const response = authenticator.authenticate({ challenge })

    assert.throws(() => verifyAuthentication({
      response, expectedChallenge: challenge, expectedOrigin: ORIGIN, expectedRpId: RP_ID
    }), /stored credential .* is required/)
  })

  test('a malformed response is refused', () => {
    assert.throws(() => verify({ response: {} }, 'x'), /missing clientDataJSON/)
  })
})

describe('signature counter', () => {
  let authenticator
  let credential

  before(() => {
    authenticator = createAuthenticator()
    const challenge = toBase64Url(randomBytes(32))
    credential = verifyRegistration({
      response: authenticator.register({ challenge }),
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRpId: RP_ID
    })
  })

  test('a counter that does not advance suggests a clone and is refused', () => {
    const challenge = toBase64Url(randomBytes(32))
    const response = authenticator.authenticate({ challenge, count: 5 })

    assert.throws(
      () => verifyAuthentication({
        response,
        credential: { ...credential, signCount: 10 },
        expectedChallenge: challenge,
        expectedOrigin: ORIGIN,
        expectedRpId: RP_ID
      }),
      /Signature counter did not increase/
    )
  })

  test('an advancing counter is accepted', () => {
    const challenge = toBase64Url(randomBytes(32))
    const response = authenticator.authenticate({ challenge, count: 11 })

    const result = verifyAuthentication({
      response,
      credential: { ...credential, signCount: 10 },
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRpId: RP_ID
    })

    assert.strictEqual(result.signCount, 11)
  })

  test('zero means unsupported, not suspicious', () => {
    // Apple and Google passkeys always report zero. Treating that as a clone
    // would reject every synced passkey in existence.
    const challenge = toBase64Url(randomBytes(32))
    const response = authenticator.authenticate({ challenge, count: 0 })

    const result = verifyAuthentication({
      response,
      credential: { ...credential, signCount: 0 },
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRpId: RP_ID
    })

    assert.strictEqual(result.verified, true)
  })
})
