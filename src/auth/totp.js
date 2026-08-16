/**
 * Time-based one-time passwords (RFC 6238, over HOTP from RFC 4226).
 *
 * SHA-1, 30-second steps, 6 digits. Those are not defaults worth changing:
 * they are what every authenticator app assumes, and an app that guesses wrong
 * produces codes that never match. SHA-1 here is not a security weakness — HMAC
 * does not depend on collision resistance, and the output is truncated to six
 * digits regardless.
 *
 * The secret is stored encrypted; see `encryptSecret`.
 */

import { createHmac, randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto'
import { encodeBase32, decodeBase32 } from './base32.js'

export const TOTP_DEFAULTS = {
  algorithm: 'sha1',
  digits: 6,
  step: 30,
  window: 1
}

/**
 * Generate a random secret.
 *
 * Twenty bytes is the RFC 4226 recommendation and matches the HMAC-SHA1 block
 * behaviour; longer buys nothing here.
 *
 * @param {number} [bytes]
 * @returns {string} base32
 */
export function generateSecret(bytes = 20) {
  return encodeBase32(randomBytes(bytes))
}

/**
 * Compute the code for a moment in time.
 *
 * @param {string} secret - base32
 * @param {Object} [options]
 * @param {number} [options.t] - unix seconds; defaults to now
 * @param {number} [options.step]
 * @param {number} [options.digits]
 * @param {string} [options.algorithm]
 * @returns {string} zero-padded code
 */
export function totp(secret, options = {}) {
  const step = options.step ?? TOTP_DEFAULTS.step
  const t = options.t ?? Math.floor(Date.now() / 1000)

  return hotp(secret, Math.floor(t / step), options)
}

/**
 * Compute the code for a counter value (HOTP).
 *
 * @param {string} secret - base32
 * @param {number} counter
 * @param {Object} [options]
 * @returns {string}
 */
export function hotp(secret, counter, options = {}) {
  const digits = options.digits ?? TOTP_DEFAULTS.digits
  const algorithm = options.algorithm ?? TOTP_DEFAULTS.algorithm

  // The counter is a 64-bit big-endian integer. Using a BigInt rather than two
  // 32-bit halves keeps it correct past 2038.
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(Math.floor(counter)))

  const digest = createHmac(algorithm, decodeBase32(secret)).update(buffer).digest()

  // Dynamic truncation: the low nibble of the last byte picks the offset.
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)

  return String(binary % 10 ** digits).padStart(digits, '0')
}

/**
 * Verify a submitted code.
 *
 * Returns the time step the code matched, which the caller must persist: a code
 * stays valid for its whole 30-second window, so without recording the step an
 * intercepted code can be replayed within it.
 *
 * @param {string} secret - base32
 * @param {string} code
 * @param {Object} [options]
 * @param {number} [options.window] - steps of tolerance either side
 * @param {number} [options.lastStep] - the most recent accepted step
 * @param {number} [options.t]
 * @returns {{ valid: boolean, step: number|null, reason?: string }}
 */
export function verifyTotp(secret, code, options = {}) {
  const digits = options.digits ?? TOTP_DEFAULTS.digits
  const step = options.step ?? TOTP_DEFAULTS.step
  const window = options.window ?? TOTP_DEFAULTS.window
  const t = options.t ?? Math.floor(Date.now() / 1000)

  const submitted = String(code ?? '').replace(/\s/g, '')

  if (!/^\d+$/.test(submitted) || submitted.length !== digits) {
    return { valid: false, step: null, reason: 'malformed' }
  }

  const current = Math.floor(t / step)

  for (let offset = -window; offset <= window; offset++) {
    const candidate = current + offset
    if (candidate < 0) continue

    const expected = hotp(secret, candidate, options)

    if (!constantTimeEquals(expected, submitted)) continue

    // A code from a step already used is a replay, not a success.
    if (options.lastStep !== undefined && options.lastStep !== null && candidate <= options.lastStep) {
      return { valid: false, step: candidate, reason: 'replayed' }
    }

    return { valid: true, step: candidate }
  }

  return { valid: false, step: null, reason: 'mismatch' }
}

/**
 * Build the otpauth:// URI an authenticator app imports.
 *
 * Deliberately no QR code: encoding one is several hundred lines for something
 * the client can render, and it keeps the secret out of any image the server
 * generates and might cache.
 *
 * @param {Object} options
 * @param {string} options.secret - base32
 * @param {string} options.label - usually the account's email
 * @param {string} [options.issuer] - the site name
 * @returns {string}
 */
export function otpauthUri({ secret, label, issuer, digits, step, algorithm } = {}) {
  if (!secret) throw new Error('otpauthUri requires a secret')
  if (!label) throw new Error('otpauthUri requires a label')

  const prefix = issuer ? `${encodeURIComponent(issuer)}:${encodeURIComponent(label)}` : encodeURIComponent(label)

  const params = new URLSearchParams({
    secret,
    algorithm: (algorithm ?? TOTP_DEFAULTS.algorithm).toUpperCase(),
    digits: String(digits ?? TOTP_DEFAULTS.digits),
    period: String(step ?? TOTP_DEFAULTS.step)
  })

  if (issuer) params.set('issuer', issuer)

  return `otpauth://totp/${prefix}?${params.toString()}`
}

/**
 * Encrypt a secret for storage.
 *
 * A database leak should not hand over working second factors. AES-256-GCM
 * under a key derived from APP_KEY, which means **rotating APP_KEY invalidates
 * every enrolled secret** — users have to re-enrol, so treat it as a migration
 * rather than a config change.
 *
 * @param {string} secret - base32
 * @param {string} [key] - defaults to APP_KEY
 * @returns {string} iv:tag:ciphertext, base64
 */
export function encryptSecret(secret, key = process.env.APP_KEY) {
  const derived = deriveKey(key)
  const iv = randomBytes(12)

  const cipher = createCipheriv('aes-256-gcm', derived, iv)
  const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':')
}

/**
 * Decrypt a stored secret.
 *
 * Returns null rather than throwing when the value cannot be read — a secret
 * encrypted under a previous APP_KEY is indistinguishable from a corrupt one,
 * and the caller's response is the same either way.
 *
 * @param {string} stored
 * @param {string} [key]
 * @returns {string|null}
 */
export function decryptSecret(stored, key = process.env.APP_KEY) {
  if (!stored || typeof stored !== 'string') return null

  const parts = stored.split(':')
  if (parts.length !== 3) return null

  try {
    const [iv, tag, payload] = parts.map((part) => Buffer.from(part, 'base64'))
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(key), iv)
    decipher.setAuthTag(tag)

    return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/**
 * APP_KEY is an arbitrary-length string; AES-256 wants exactly 32 bytes.
 */
function deriveKey(key) {
  if (!key) {
    throw new Error('Encrypting a TOTP secret requires APP_KEY')
  }
  return createHash('sha256').update(String(key)).digest()
}

/**
 * Compare codes without leaking their contents through timing.
 */
function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))

  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
