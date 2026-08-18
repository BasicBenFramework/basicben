/**
 * WebAuthn / passkeys.
 *
 * Verification of registration and authentication, with no dependency —
 * node:crypto covers the hashing and the signatures, and the CBOR and COSE
 * layers alongside cover the encoding.
 *
 * ## What this deliberately does not do
 *
 * **Attestation is not verified.** Registration extracts the public key from the
 * attestation object but does not check the authenticator's certificate chain.
 * Doing so means parsing X.509, tracking a metadata service, and deciding which
 * manufacturers to trust — which consumer sites do not do, and doing it badly is
 * worse than not doing it. Request `attestation: "none"`. If you need to prove a
 * credential came from particular hardware, this is not enough.
 *
 * **ES256 and RS256 only.** Between them they cover Apple, Google, Windows Hello
 * and every modern security key.
 *
 * ## What it will not skip
 *
 * Each of these is an authentication bypass if omitted, so none is optional and
 * each has a test that fails loudly when removed: the ceremony type, the
 * challenge, the origin, the RP ID hash, user presence, that the credential
 * belongs to the user being authenticated, and the signature itself.
 */

import { createHash, createVerify, randomBytes, timingSafeEqual } from 'node:crypto'
import { decodeCbor } from './cbor.js'
import { coseToPublicKey } from './cose.js'
import { parseAuthenticatorData, parseClientData, fromBase64Url, toBase64Url } from './parse.js'

export { parseAuthenticatorData, parseClientData, fromBase64Url, toBase64Url } from './parse.js'
export { decodeCbor } from './cbor.js'
export { coseToSpki, coseToPublicKey } from './cose.js'

/** Algorithms offered at registration, best first. */
const SUPPORTED_ALGORITHMS = [-7, -257] // ES256, RS256

/**
 * Options for `navigator.credentials.create()`.
 *
 * The challenge is returned separately so the caller can store it: it must be
 * checked server-side, and a challenge the client chooses is no challenge.
 *
 * @param {Object} options
 * @param {string} options.rpId
 * @param {string} options.rpName
 * @param {{ id: string|number, name: string, displayName?: string, handle?: string|number }} options.user
 *   `handle` is what gets stored on the authenticator, and it may be visible;
 *   pass an opaque one so the row id is not enumerable. Defaults to `id`.
 * @param {Array} [options.excludeCredentials]
 * @param {string} [options.userVerification]
 * @param {number} [options.timeout]
 * @returns {{ options: Object, challenge: string }}
 */
export function generateRegistrationOptions({
  rpId,
  rpName,
  user,
  excludeCredentials = [],
  userVerification = 'preferred',
  timeout = 60000
} = {}) {
  if (!rpId) throw new Error('generateRegistrationOptions requires rpId')
  if (!user?.id) throw new Error('generateRegistrationOptions requires a user with an id')

  const challenge = toBase64Url(randomBytes(32))

  return {
    challenge,
    options: {
      challenge,
      rp: { id: rpId, name: rpName || rpId },
      user: {
        // Not the database id: a user handle is stored on the authenticator and
        // may be visible, so it should not leak an enumerable primary key.
        id: toBase64Url(Buffer.from(String(user.handle ?? user.id))),
        name: user.name,
        displayName: user.displayName || user.name
      },
      pubKeyCredParams: SUPPORTED_ALGORITHMS.map((alg) => ({ type: 'public-key', alg })),
      timeout,
      // Without this the browser may return a full attestation statement that
      // this implementation would not verify — better to not ask for it.
      attestation: 'none',
      excludeCredentials,
      authenticatorSelection: { userVerification, residentKey: 'preferred' }
    }
  }
}

/**
 * Options for `navigator.credentials.get()`.
 *
 * @param {Object} options
 * @returns {{ options: Object, challenge: string }}
 */
export function generateAuthenticationOptions({
  rpId,
  allowCredentials = [],
  userVerification = 'preferred',
  timeout = 60000
} = {}) {
  if (!rpId) throw new Error('generateAuthenticationOptions requires rpId')

  const challenge = toBase64Url(randomBytes(32))

  return {
    challenge,
    options: { challenge, rpId, allowCredentials, userVerification, timeout }
  }
}

/**
 * Verify a registration response.
 *
 * @param {Object} params
 * @param {{ id: string, response: { clientDataJSON: string, attestationObject: string } }} params.response
 * @param {string} params.expectedChallenge
 * @param {string|string[]} params.expectedOrigin
 * @param {string} params.expectedRpId
 * @param {boolean} [params.requireUserVerification]
 * @returns {{
 *   credentialId: string,
 *   publicKey: string,
 *   algorithm: number,
 *   signCount: number,
 *   aaguid: string|null,
 *   userVerified: boolean,
 *   backedUp: boolean,
 *   attestationFormat: string|null
 * }}
 */
export function verifyRegistration({
  response,
  expectedChallenge,
  expectedOrigin,
  expectedRpId,
  requireUserVerification = false
} = {}) {
  if (!response?.response?.clientDataJSON || !response?.response?.attestationObject) {
    throw new Error('Registration response is missing clientDataJSON or attestationObject')
  }

  const clientDataBytes = fromBase64Url(response.response.clientDataJSON)
  const clientData = parseClientData(clientDataBytes)

  assertCeremony(clientData, 'webauthn.create')
  assertChallenge(clientData, expectedChallenge)
  assertOrigin(clientData, expectedOrigin)

  const attestation = decodeCbor(fromBase64Url(response.response.attestationObject))
  if (!(attestation instanceof Map)) {
    throw new Error('Attestation object must be a CBOR map')
  }

  const authDataBytes = attestation.get('authData')
  if (!Buffer.isBuffer(authDataBytes)) {
    throw new Error('Attestation object is missing authData')
  }

  const authData = parseAuthenticatorData(authDataBytes)

  assertRpId(authData, expectedRpId)
  assertUserFlags(authData, requireUserVerification)

  if (!authData.hasAttestedCredentialData || !authData.credentialId || !authData.credentialPublicKey) {
    throw new Error('Registration response carries no credential')
  }

  // Converting the key now means a key this server cannot use is rejected at
  // registration rather than at the first sign-in attempt.
  const { spki, algorithm } = coseToPublicKeyMaterial(authData.credentialPublicKey)

  return {
    credentialId: toBase64Url(authData.credentialId),
    publicKey: spki.toString('base64'),
    algorithm,
    signCount: authData.signCount,
    aaguid: authData.aaguid ? toBase64Url(authData.aaguid) : null,
    userVerified: authData.userVerified,
    backedUp: authData.backedUp,
    attestationFormat: attestation.get('fmt') ?? null
  }
}

/**
 * Verify an authentication response.
 *
 * @param {Object} params
 * @param {Object} params.response
 * @param {{ credentialId: string, publicKey: string, signCount?: number }} params.credential
 * @param {string} params.expectedChallenge
 * @param {string|string[]} params.expectedOrigin
 * @param {string} params.expectedRpId
 * @param {boolean} [params.requireUserVerification]
 * @returns {{ verified: true, signCount: number, userVerified: boolean }}
 */
export function verifyAuthentication({
  response,
  credential,
  expectedChallenge,
  expectedOrigin,
  expectedRpId,
  requireUserVerification = false
} = {}) {
  if (!response?.response?.clientDataJSON || !response?.response?.authenticatorData || !response?.response?.signature) {
    throw new Error('Authentication response is missing clientDataJSON, authenticatorData or signature')
  }

  if (!credential?.credentialId || !credential?.publicKey) {
    throw new Error('A stored credential with credentialId and publicKey is required')
  }

  // The credential presented must be the one being checked. Without this an
  // attacker could sign with their own passkey and have it accepted against
  // someone else's account.
  const presented = normalizeCredentialId(response.id ?? response.rawId)
  if (presented !== normalizeCredentialId(credential.credentialId)) {
    throw new Error('The credential presented is not the credential being verified')
  }

  const clientDataBytes = fromBase64Url(response.response.clientDataJSON)
  const clientData = parseClientData(clientDataBytes)

  assertCeremony(clientData, 'webauthn.get')
  assertChallenge(clientData, expectedChallenge)
  assertOrigin(clientData, expectedOrigin)

  const authDataBytes = fromBase64Url(response.response.authenticatorData)
  const authData = parseAuthenticatorData(authDataBytes)

  assertRpId(authData, expectedRpId)
  assertUserFlags(authData, requireUserVerification)

  // The signature covers authenticatorData concatenated with the hash of
  // clientDataJSON — not the JSON itself.
  const signatureBase = Buffer.concat([
    authDataBytes,
    createHash('sha256').update(clientDataBytes).digest()
  ])

  const publicKey = publicKeyFromStored(credential.publicKey)
  const signature = fromBase64Url(response.response.signature)

  const verified = createVerify('SHA256').update(signatureBase).verify(publicKey, signature)

  if (!verified) {
    throw new Error('Signature verification failed')
  }

  assertSignCount(authData.signCount, credential.signCount)

  return {
    verified: true,
    signCount: authData.signCount,
    userVerified: authData.userVerified,
    backedUp: authData.backedUp
  }
}

/**
 * The ceremony type distinguishes a registration response from an
 * authentication one. Without this check a registration response could be
 * replayed as a sign-in.
 */
function assertCeremony(clientData, expected) {
  if (clientData.type !== expected) {
    throw new Error(`Expected ceremony type "${expected}" but got "${clientData.type}"`)
  }
}

function assertChallenge(clientData, expected) {
  if (!expected) {
    throw new Error('An expected challenge is required')
  }

  const received = fromBase64Url(clientData.challenge)
  const wanted = fromBase64Url(expected)

  if (received.length !== wanted.length || !timingSafeEqual(received, wanted)) {
    throw new Error('Challenge mismatch')
  }
}

function assertOrigin(clientData, expected) {
  const allowed = (Array.isArray(expected) ? expected : [expected]).filter(Boolean)

  if (allowed.length === 0) {
    throw new Error('An expected origin is required')
  }

  if (!allowed.includes(clientData.origin)) {
    throw new Error(`Origin "${clientData.origin}" is not allowed`)
  }
}

function assertRpId(authData, expectedRpId) {
  if (!expectedRpId) {
    throw new Error('An expected rpId is required')
  }

  const expected = createHash('sha256').update(expectedRpId, 'utf8').digest()

  if (authData.rpIdHash.length !== expected.length || !timingSafeEqual(authData.rpIdHash, expected)) {
    throw new Error('RP ID hash mismatch')
  }
}

function assertUserFlags(authData, requireUserVerification) {
  // User presence means somebody physically interacted with the authenticator.
  if (!authData.userPresent) {
    throw new Error('User presence flag was not set')
  }

  if (requireUserVerification && !authData.userVerified) {
    throw new Error('User verification was required but the authenticator did not perform it')
  }
}

/**
 * A counter that fails to advance suggests a cloned authenticator.
 *
 * Many passkeys — Apple's and Google's included — always report zero, so zero
 * means "not supported" rather than "suspicious". Treating it as a failure
 * would break every synced passkey.
 */
function assertSignCount(received, stored) {
  if (!stored || !received) return

  if (received <= stored) {
    throw new Error(
      `Signature counter did not increase (stored ${stored}, received ${received}); ` +
      'the authenticator may have been cloned'
    )
  }
}

function coseToPublicKeyMaterial(cose) {
  const { key, algorithm } = coseToPublicKey(cose)
  return { spki: key.export({ format: 'der', type: 'spki' }), algorithm }
}

function publicKeyFromStored(stored) {
  const der = Buffer.from(stored, 'base64')
  return { key: der, format: 'der', type: 'spki' }
}

function normalizeCredentialId(value) {
  if (!value) return ''
  return toBase64Url(fromBase64Url(String(value)))
}
