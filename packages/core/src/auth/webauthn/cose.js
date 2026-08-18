/**
 * COSE public keys → SPKI DER.
 *
 * An authenticator hands back its public key as a COSE_Key (RFC 8152). Node's
 * verifier wants SPKI DER, so the key has to be repackaged. The conversion is
 * mechanical: for EC the whole prefix is a constant and only the point varies;
 * for RSA the modulus and exponent go into a small DER structure.
 *
 * Two algorithms, deliberately. ES256 covers Apple, Google, Windows Hello and
 * every modern security key; RS256 covers older Windows Hello. EdDSA is rare
 * enough that supporting it untested would be worse than not supporting it.
 */

import { createPublicKey } from 'node:crypto'

/** COSE key type */
export const KTY = { EC2: 2, RSA: 3 }

/** COSE algorithm identifiers */
export const ALG = { ES256: -7, RS256: -257 }

/** COSE elliptic curve identifiers */
export const CRV = { P256: 1 }

/**
 * Everything before the elliptic-curve point in a P-256 SPKI.
 *
 *   SEQUENCE {
 *     SEQUENCE { OID ecPublicKey, OID prime256v1 }
 *     BIT STRING (unused bits: 0) {
 *
 * The lengths are fixed because a P-256 point is always 65 bytes, so this can
 * be a constant rather than assembled.
 */
const P256_SPKI_PREFIX = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200',
  'hex'
)

/** SEQUENCE { OID rsaEncryption, NULL } */
const RSA_ALGORITHM_ID = Buffer.from('300d06092a864886f70d0101010500', 'hex')

/**
 * Convert a decoded COSE key to SPKI DER.
 *
 * @param {Map} cose - as produced by the CBOR decoder
 * @returns {{ spki: Buffer, algorithm: number }}
 */
export function coseToSpki(cose) {
  if (!(cose instanceof Map)) {
    throw new Error('COSE key must be a CBOR map')
  }

  const kty = cose.get(1)
  const alg = cose.get(3)

  if (kty === KTY.EC2) {
    if (alg !== ALG.ES256) {
      throw new Error(`Unsupported COSE algorithm ${alg} for an EC2 key (expected ES256)`)
    }
    return { spki: ec2ToSpki(cose), algorithm: alg }
  }

  if (kty === KTY.RSA) {
    if (alg !== ALG.RS256) {
      throw new Error(`Unsupported COSE algorithm ${alg} for an RSA key (expected RS256)`)
    }
    return { spki: rsaToSpki(cose), algorithm: alg }
  }

  throw new Error(`Unsupported COSE key type ${kty}`)
}

/**
 * Turn a COSE key into something node:crypto can verify with.
 *
 * @param {Map} cose
 * @returns {{ key: import('node:crypto').KeyObject, algorithm: number }}
 */
export function coseToPublicKey(cose) {
  const { spki, algorithm } = coseToSpki(cose)

  return {
    key: createPublicKey({ key: spki, format: 'der', type: 'spki' }),
    algorithm
  }
}

function ec2ToSpki(cose) {
  const crv = cose.get(-1)
  const x = cose.get(-2)
  const y = cose.get(-3)

  if (crv !== CRV.P256) {
    throw new Error(`Unsupported COSE curve ${crv} (expected P-256)`)
  }

  if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
    throw new Error('COSE EC2 key is missing its x or y coordinate')
  }

  // A P-256 coordinate is exactly 32 bytes. Accepting a short one and padding
  // would silently accept a malformed key, so refuse instead.
  if (x.length !== 32 || y.length !== 32) {
    throw new Error(`COSE EC2 coordinates must be 32 bytes (got x=${x.length}, y=${y.length})`)
  }

  // 0x04 marks an uncompressed point.
  return Buffer.concat([P256_SPKI_PREFIX, Buffer.from([0x04]), x, y])
}

function rsaToSpki(cose) {
  const n = cose.get(-1)
  const e = cose.get(-2)

  if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) {
    throw new Error('COSE RSA key is missing its modulus or exponent')
  }

  const publicKey = derSequence(Buffer.concat([derInteger(n), derInteger(e)]))

  // The RSAPublicKey structure sits inside a BIT STRING with no unused bits.
  const bitString = derTagged(0x03, Buffer.concat([Buffer.from([0x00]), publicKey]))

  return derSequence(Buffer.concat([RSA_ALGORITHM_ID, bitString]))
}

/**
 * DER INTEGER.
 *
 * DER integers are signed, so a value whose top bit is set needs a leading zero
 * or it would be read as negative. Leading zero bytes are otherwise stripped.
 */
function derInteger(bytes) {
  let value = bytes

  let start = 0
  while (start < value.length - 1 && value[start] === 0x00) start++
  value = value.subarray(start)

  if (value[0] & 0x80) {
    value = Buffer.concat([Buffer.from([0x00]), value])
  }

  return derTagged(0x02, value)
}

function derSequence(contents) {
  return derTagged(0x30, contents)
}

function derTagged(tag, contents) {
  return Buffer.concat([Buffer.from([tag]), derLength(contents.length), contents])
}

/**
 * DER length: short form below 128, otherwise a byte count followed by the
 * length itself, big-endian.
 */
function derLength(length) {
  if (length < 0x80) return Buffer.from([length])

  const bytes = []
  let remaining = length
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining >>= 8
  }

  return Buffer.from([0x80 | bytes.length, ...bytes])
}
