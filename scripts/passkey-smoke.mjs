/**
 * Drive the passkey endpoints of a running app with a virtual authenticator.
 *
 * This is the end-to-end half of the WebAuthn work: the unit tests verify the
 * ceremony logic in isolation, and this proves the wiring — challenge storage,
 * credential lookup, and the login handoff — actually holds together over HTTP.
 *
 * Usage: node scripts/passkey-smoke.mjs <baseUrl> <sessionToken> <email> <password>
 */

import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'

const [baseUrl, sessionToken, email, password] = process.argv.slice(2)

if (!baseUrl || !sessionToken || !email || !password) {
  console.error('usage: passkey-smoke.mjs <baseUrl> <sessionToken> <email> <password>')
  process.exit(2)
}

// Must match what the server derives from APP_URL.
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost'
const ORIGIN = process.env.APP_URL || 'http://localhost:3000'

const b64u = (b) => Buffer.from(b).toString('base64url')
const fromB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

// --- minimal CBOR encoder ---------------------------------------------------

function head(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length])
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length])
  const b = Buffer.alloc(3)
  b[0] = (major << 5) | 25
  b.writeUInt16BE(length, 1)
  return b
}

function cbor(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value])
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8')
    return Buffer.concat([head(3, bytes.length), bytes])
  }
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -value - 1)
  if (value instanceof Map) {
    const parts = [head(5, value.size)]
    for (const [k, v] of value) parts.push(cbor(k), cbor(v))
    return Buffer.concat(parts)
  }
  throw new Error(`cannot encode ${typeof value}`)
}

// --- virtual authenticator --------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const credentialId = randomBytes(32)
const jwk = publicKey.export({ format: 'jwk' })

const coseKey = new Map([
  [1, 2], [3, -7], [-1, 1],
  [-2, Buffer.from(jwk.x, 'base64url')],
  [-3, Buffer.from(jwk.y, 'base64url')]
])

function authData({ flags, includeCredential, count = 0 }) {
  const rpIdHash = createHash('sha256').update(RP_ID, 'utf8').digest()
  const header = Buffer.alloc(5)
  header[0] = flags
  header.writeUInt32BE(count, 1)

  if (!includeCredential) return Buffer.concat([rpIdHash, header])

  const idLength = Buffer.alloc(2)
  idLength.writeUInt16BE(credentialId.length)

  return Buffer.concat([rpIdHash, header, randomBytes(16), idLength, credentialId, cbor(coseKey)])
}

function clientData(type, challenge) {
  return Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }), 'utf8')
}

// --- helpers ----------------------------------------------------------------

async function post(path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

function fail(message, detail) {
  console.error(`FAIL: ${message}`)
  if (detail) console.error(JSON.stringify(detail, null, 2))
  process.exit(1)
}

// --- the flow ---------------------------------------------------------------

// 1. Ask to enrol. Requires the password even though we hold a session.
const options = await post('/api/auth/passkeys/options', { password }, sessionToken)
if (options.status !== 200 || !options.body.challengeHandle) {
  fail('could not get registration options', options.body)
}
console.log('ok registration options issued')

// A wrong password must not get options.
const refused = await post('/api/auth/passkeys/options', { password: 'wrong-password' }, sessionToken)
if (refused.status !== 403) fail('enrolment should require the correct password', refused.body)
console.log('ok enrolment requires the current password')

// 2. Build and submit the registration response.
const regChallenge = options.body.options.challenge
const regClientData = clientData('webauthn.create', regChallenge)
const attestationObject = cbor(new Map([
  ['fmt', 'none'],
  ['attStmt', new Map()],
  ['authData', authData({ flags: 0x45, includeCredential: true })]
]))

const enrolled = await post('/api/auth/passkeys/verify', {
  challengeHandle: options.body.challengeHandle,
  label: 'Smoke test key',
  response: {
    id: b64u(credentialId),
    rawId: b64u(credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: b64u(regClientData),
      attestationObject: b64u(attestationObject)
    }
  }
}, sessionToken)

if (enrolled.status !== 200 || !enrolled.body.enrolled) fail('passkey enrolment failed', enrolled.body)
console.log('ok passkey enrolled')

// 3. A password alone must now be insufficient, and passkey must be offered.
const login = await post('/api/auth/login', { email, password })
if (!login.body.twoFactorRequired) fail('login should now require a second factor', login.body)
if (!login.body.methods?.includes('passkey')) fail('passkey should be an offered method', login.body)
if (login.body.token) fail('login must not return a session token alongside a challenge', login.body)
console.log('ok password alone no longer signs in, passkey offered')

// 4. Get assertion options using the login challenge.
const assertOptions = await post('/api/auth/passkey/options', { challenge: login.body.challenge })
if (assertOptions.status !== 200 || !assertOptions.body.challengeHandle) {
  fail('could not get assertion options', assertOptions.body)
}
console.log('ok assertion options issued')

// 5. Sign the assertion and complete the sign-in.
const authChallenge = assertOptions.body.options.challenge
const authClientData = clientData('webauthn.get', authChallenge)
const assertionAuthData = authData({ flags: 0x05, includeCredential: false, count: 1 })
const signature = createSign('SHA256')
  .update(Buffer.concat([assertionAuthData, createHash('sha256').update(authClientData).digest()]))
  .sign(privateKey)

const verified = await post('/api/auth/2fa/verify', {
  challengeHandle: assertOptions.body.challengeHandle,
  response: {
    id: b64u(credentialId),
    rawId: b64u(credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: b64u(authClientData),
      authenticatorData: b64u(assertionAuthData),
      signature: b64u(signature)
    }
  }
})

if (verified.status !== 200 || !verified.body.token) fail('passkey sign-in failed', verified.body)
console.log('ok signed in with a passkey')

// 6. A tampered signature must be refused, over the real HTTP path.
const login2 = await post('/api/auth/login', { email, password })
const opts2 = await post('/api/auth/passkey/options', { challenge: login2.body.challenge })
const clientData2 = clientData('webauthn.get', opts2.body.options.challenge)
const authData2 = authData({ flags: 0x05, includeCredential: false, count: 2 })
const badSignature = createSign('SHA256')
  .update(Buffer.concat([authData2, createHash('sha256').update(clientData2).digest()]))
  .sign(privateKey)
badSignature[badSignature.length - 1] ^= 0xff

const rejected = await post('/api/auth/2fa/verify', {
  challengeHandle: opts2.body.challengeHandle,
  response: {
    id: b64u(credentialId),
    rawId: b64u(credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: b64u(clientData2),
      authenticatorData: b64u(authData2),
      signature: b64u(badSignature)
    }
  }
})

if (rejected.status === 200 || rejected.body.token) fail('a tampered signature was accepted', rejected.body)
console.log('ok a tampered signature is refused')

// 7. A spent challenge cannot be reused.
const replayed = await post('/api/auth/2fa/verify', {
  challengeHandle: assertOptions.body.challengeHandle,
  response: { id: b64u(credentialId), rawId: b64u(credentialId), type: 'public-key', response: {} }
})
if (replayed.status === 200) fail('a spent challenge was accepted again', replayed.body)
console.log('ok a spent challenge cannot be replayed')

void fromB64u
