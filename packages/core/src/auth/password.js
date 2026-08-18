/**
 * Secure password hashing using node:crypto scrypt.
 *
 * Comparable to bcrypt/Argon2 used by Laravel and Next.js.
 * - Deliberately slow (configurable cost)
 * - Automatic random salt
 * - Timing-safe comparison
 */

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

// Default parameters (similar to bcrypt cost factor 10)
const DEFAULT_KEY_LENGTH = 64
const DEFAULT_COST = 16384  // N - CPU/memory cost (2^14)
const DEFAULT_BLOCK_SIZE = 8  // r
const DEFAULT_PARALLELIZATION = 1  // p
const SALT_LENGTH = 16

/**
 * Hash a password securely
 *
 * @param {string} password - Plain text password
 * @param {Object} options - Optional parameters
 * @returns {Promise<string>} - Hash in format: salt:hash:params
 *
 * @example
 * const hash = await hashPassword('mysecretpassword')
 * // Store hash in database
 */
export async function hashPassword(password, options = {}) {
  const {
    keyLength = DEFAULT_KEY_LENGTH,
    cost = DEFAULT_COST,
    blockSize = DEFAULT_BLOCK_SIZE,
    parallelization = DEFAULT_PARALLELIZATION
  } = options

  const salt = randomBytes(SALT_LENGTH)

  const derivedKey = await scryptAsync(password, salt, keyLength, {
    N: cost,
    r: blockSize,
    p: parallelization
  })

  // Format: base64(salt):base64(hash):N:r:p:keylen
  const params = `${cost}:${blockSize}:${parallelization}:${keyLength}`
  return `${salt.toString('base64')}:${derivedKey.toString('base64')}:${params}`
}

/**
 * Verify a password against a hash
 *
 * @param {string} password - Plain text password to verify
 * @param {string} hash - Stored hash from hashPassword()
 * @returns {Promise<boolean>} - True if password matches
 *
 * @example
 * const isValid = await verifyPassword('mysecretpassword', storedHash)
 * if (!isValid) {
 *   // Invalid password
 * }
 */
export async function verifyPassword(password, hash) {
  if (!password || !hash) {
    return false
  }

  try {
    const parts = hash.split(':')
    if (parts.length !== 6) {
      return false
    }

    const [saltB64, hashB64, costStr, blockSizeStr, parallelizationStr, keyLengthStr] = parts

    const salt = Buffer.from(saltB64, 'base64')
    const storedHash = Buffer.from(hashB64, 'base64')
    const cost = parseInt(costStr, 10)
    const blockSize = parseInt(blockSizeStr, 10)
    const parallelization = parseInt(parallelizationStr, 10)
    const keyLength = parseInt(keyLengthStr, 10)

    const derivedKey = await scryptAsync(password, salt, keyLength, {
      N: cost,
      r: blockSize,
      p: parallelization
    })

    // Timing-safe comparison to prevent timing attacks
    return timingSafeEqual(storedHash, derivedKey)
  } catch {
    return false
  }
}

/**
 * Check if a hash needs to be rehashed (e.g., cost factor increased)
 *
 * @param {string} hash - Stored hash
 * @param {Object} options - Current desired parameters
 * @returns {boolean} - True if hash should be regenerated
 */
export function needsRehash(hash, options = {}) {
  const {
    cost = DEFAULT_COST,
    blockSize = DEFAULT_BLOCK_SIZE,
    parallelization = DEFAULT_PARALLELIZATION,
    keyLength = DEFAULT_KEY_LENGTH
  } = options

  try {
    const parts = hash.split(':')
    if (parts.length !== 6) {
      return true
    }

    const [, , costStr, blockSizeStr, parallelizationStr, keyLengthStr] = parts

    return (
      parseInt(costStr, 10) !== cost ||
      parseInt(blockSizeStr, 10) !== blockSize ||
      parseInt(parallelizationStr, 10) !== parallelization ||
      parseInt(keyLengthStr, 10) !== keyLength
    )
  } catch {
    return true
  }
}
