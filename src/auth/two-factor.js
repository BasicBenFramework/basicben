/**
 * Second-factor support shared by every method.
 *
 * Recovery codes, and the attempt limiting a six-digit code needs — a million
 * possibilities is not many when an attacker can try them at network speed, so
 * the code itself is only as strong as the limit on guesses.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { hashPassword, verifyPassword } from './password.js'

export const RECOVERY_CODE_COUNT = 10

/** Failures before the second factor locks. */
export const MAX_ATTEMPTS = 5

/** How long a lock lasts. */
export const LOCKOUT_MS = 15 * 60 * 1000

// Excludes characters that are misread when transcribed from paper: 0/O, 1/l/I.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/**
 * Generate recovery codes.
 *
 * Returned in plaintext exactly once. Hyphenated because they are meant to be
 * written down, and a run of ten characters is easy to lose your place in.
 *
 * @param {number} [count]
 * @returns {string[]}
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  return Array.from({ length: count }, () => `${randomChunk(4)}-${randomChunk(4)}`)
}

/**
 * Hash recovery codes for storage.
 *
 * scrypt, unlike the URL-safe tokens in `tokens.js`. These are short and
 * human-transcribed, so their entropy is low enough that a fast hash would let
 * a leaked table be brute-forced offline.
 *
 * @param {string[]} codes
 * @returns {Promise<string[]>}
 */
export function hashRecoveryCodes(codes) {
  return Promise.all(codes.map((code) => hashPassword(normalizeCode(code))))
}

/**
 * Check a submitted recovery code against the stored hashes.
 *
 * Returns the index of the code that matched so the caller can consume it — a
 * recovery code is single use.
 *
 * @param {string} submitted
 * @param {string[]} hashes
 * @returns {Promise<number>} index, or -1
 */
export async function findRecoveryCode(submitted, hashes = []) {
  const normalized = normalizeCode(submitted)
  if (!normalized) return -1

  for (let i = 0; i < hashes.length; i++) {
    // Sequential rather than parallel: scrypt is deliberately expensive, and
    // ten at once would be a self-inflicted load spike on every attempt.
    if (await verifyPassword(normalized, hashes[i])) return i
  }

  return -1
}

/**
 * Accept a code however the user typed it.
 *
 * @param {string} code
 * @returns {string}
 */
export function normalizeCode(code) {
  return String(code ?? '').toLowerCase().replace(/[\s-]/g, '')
}

/**
 * Whether a second factor is currently locked out.
 *
 * @param {Object} record - carries locked_until
 * @param {number} [now]
 * @returns {{ locked: boolean, until: Date|null, retryAfter: number }}
 */
export function lockoutState(record, now = Date.now()) {
  const until = record?.locked_until ? new Date(record.locked_until).getTime() : 0

  if (!until || until <= now) {
    return { locked: false, until: null, retryAfter: 0 }
  }

  return {
    locked: true,
    until: new Date(until),
    retryAfter: Math.ceil((until - now) / 1000)
  }
}

/**
 * Work out the new attempt state after a failure.
 *
 * Returned rather than written, so the caller owns the storage — the framework
 * has no opinion about where a project keeps this.
 *
 * @param {Object} record - carries failed_attempts
 * @param {Object} [options]
 * @returns {{ failedAttempts: number, lockedUntil: string|null, locked: boolean }}
 */
export function registerFailure(record, options = {}) {
  const max = options.maxAttempts ?? MAX_ATTEMPTS
  const lockoutMs = options.lockoutMs ?? LOCKOUT_MS

  const failedAttempts = Number(record?.failed_attempts ?? 0) + 1

  if (failedAttempts < max) {
    return { failedAttempts, lockedUntil: null, locked: false }
  }

  return {
    failedAttempts: 0, // the lock replaces the count; it resets when it expires
    lockedUntil: new Date(Date.now() + lockoutMs).toISOString(),
    locked: true
  }
}

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEquals(a, b) {
  const left = Buffer.from(String(a ?? ''))
  const right = Buffer.from(String(b ?? ''))

  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function randomChunk(length) {
  const bytes = randomBytes(length)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return out
}
