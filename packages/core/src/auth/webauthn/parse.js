/**
 * Parsing the two structures an authenticator returns.
 *
 * `authenticatorData` is a packed binary layout; `clientDataJSON` is JSON the
 * browser produces. Both are attacker-influenced, so everything here validates
 * lengths before reading and never trusts a declared size.
 */

import { decodeCborFirst } from './cbor.js'

/** Flag bits in authenticatorData. */
export const FLAGS = {
  USER_PRESENT: 0x01,
  USER_VERIFIED: 0x04,
  BACKUP_ELIGIBLE: 0x08,
  BACKED_UP: 0x10,
  ATTESTED_CREDENTIAL_DATA: 0x40,
  EXTENSION_DATA: 0x80
}

/**
 * Parse authenticatorData.
 *
 * Layout: rpIdHash(32) ‖ flags(1) ‖ signCount(4) ‖ [attestedCredentialData] ‖
 * [extensions].
 *
 * @param {Uint8Array|Buffer} input
 * @returns {Object}
 */
export function parseAuthenticatorData(input) {
  const data = Buffer.from(input)

  if (data.length < 37) {
    throw new Error(`authenticatorData must be at least 37 bytes, got ${data.length}`)
  }

  const rpIdHash = data.subarray(0, 32)
  const flags = data[32]
  const signCount = data.readUInt32BE(33)

  const parsed = {
    rpIdHash,
    flags,
    signCount,
    userPresent: Boolean(flags & FLAGS.USER_PRESENT),
    userVerified: Boolean(flags & FLAGS.USER_VERIFIED),
    backupEligible: Boolean(flags & FLAGS.BACKUP_ELIGIBLE),
    backedUp: Boolean(flags & FLAGS.BACKED_UP),
    hasAttestedCredentialData: Boolean(flags & FLAGS.ATTESTED_CREDENTIAL_DATA),
    hasExtensions: Boolean(flags & FLAGS.EXTENSION_DATA),
    credentialId: null,
    credentialPublicKey: null,
    aaguid: null
  }

  let offset = 37

  if (parsed.hasAttestedCredentialData) {
    if (data.length < offset + 18) {
      throw new Error('authenticatorData claims attested credential data but is too short')
    }

    parsed.aaguid = data.subarray(offset, offset + 16)
    offset += 16

    const credentialIdLength = data.readUInt16BE(offset)
    offset += 2

    // The length is attacker-controlled; the spec caps a credential ID at 1023
    // bytes, and anything longer is malformed rather than merely unusual.
    if (credentialIdLength > 1023) {
      throw new Error(`Credential ID length ${credentialIdLength} exceeds the 1023-byte maximum`)
    }

    if (data.length < offset + credentialIdLength) {
      throw new Error('Credential ID runs past the end of authenticatorData')
    }

    parsed.credentialId = data.subarray(offset, offset + credentialIdLength)
    offset += credentialIdLength

    // The COSE key is CBOR of unknown length, so the decoder reports where it
    // ended rather than being told.
    const { value, offset: next } = decodeCborFirst(data.subarray(offset))
    parsed.credentialPublicKey = value
    offset += next
  }

  return parsed
}

/**
 * Parse and sanity-check clientDataJSON.
 *
 * @param {Uint8Array|Buffer} input
 * @returns {{ type: string, challenge: string, origin: string, crossOrigin?: boolean }}
 */
export function parseClientData(input) {
  const text = Buffer.from(input).toString('utf8')

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('clientDataJSON is not valid JSON')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('clientDataJSON must be an object')
  }

  for (const field of ['type', 'challenge', 'origin']) {
    if (typeof parsed[field] !== 'string') {
      throw new Error(`clientDataJSON is missing "${field}"`)
    }
  }

  return parsed
}

/**
 * Decode base64url, tolerating standard base64 too.
 *
 * @param {string} value
 * @returns {Buffer}
 */
export function fromBase64Url(value) {
  return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Encode as base64url without padding, which is what WebAuthn uses throughout.
 *
 * @param {Uint8Array|Buffer} value
 * @returns {string}
 */
export function toBase64Url(value) {
  return Buffer.from(value).toString('base64url')
}
