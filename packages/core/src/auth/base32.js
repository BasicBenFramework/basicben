/**
 * Base32 (RFC 4648).
 *
 * Authenticator apps expect a shared secret in this encoding — it is what an
 * otpauth:// URI carries and what a user types when they cannot scan a code.
 * Padding is omitted, which is what every authenticator produces and accepts.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * Encode bytes as base32, without padding.
 *
 * @param {Uint8Array|Buffer} bytes
 * @returns {string}
 */
export function encodeBase32(bytes) {
  const data = Buffer.from(bytes)
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of data) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  // Whatever is left is padded on the right with zero bits.
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31]
  }

  return output
}

/**
 * Decode base32 to bytes.
 *
 * Tolerant of what a person actually types: lowercase, padding, and the spaces
 * authenticator apps insert to make a secret readable.
 *
 * @param {string} input
 * @returns {Buffer}
 */
export function decodeBase32(input) {
  const cleaned = String(input).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')

  let bits = 0
  let value = 0
  const output = []

  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) {
      throw new Error(`Invalid base32 character "${char}"`)
    }

    value = (value << 5) | index
    bits += 5

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return Buffer.from(output)
}
