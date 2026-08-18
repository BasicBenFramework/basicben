/**
 * Auth helpers using node:crypto.
 * No jsonwebtoken or bcrypt dependencies needed.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

// Re-export password helpers
export { hashPassword, verifyPassword, needsRehash } from './password.js'

/**
 * Sign a JWT token
 *
 * @param {Object} payload - Data to encode in the token
 * @param {string} secret - Secret key for signing
 * @param {Object} options - Options (expiresIn)
 * @returns {string} - JWT token
 *
 * @example
 * const token = signJwt({ userId: 1 }, process.env.APP_KEY, { expiresIn: '7d' })
 */
export function signJwt(payload, secret, options = {}) {
  if (!secret) {
    throw new Error('JWT secret is required')
  }

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  }

  const now = Math.floor(Date.now() / 1000)

  const tokenPayload = {
    ...payload,
    iat: now
  }

  // Handle expiration
  if (options.expiresIn) {
    tokenPayload.exp = now + parseExpiry(options.expiresIn)
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload))

  const signature = sign(`${encodedHeader}.${encodedPayload}`, secret)

  return `${encodedHeader}.${encodedPayload}.${signature}`
}

/**
 * Verify and decode a JWT token
 *
 * @param {string} token - JWT token to verify
 * @param {string} secret - Secret key used for signing
 * @returns {Object|null} - Decoded payload or null if invalid
 *
 * @example
 * const payload = verifyJwt(token, process.env.APP_KEY)
 * if (!payload) {
 *   // Invalid or expired token
 * }
 */
export function verifyJwt(token, secret) {
  if (!token || !secret) {
    return null
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }

  const [encodedHeader, encodedPayload, signature] = parts

  // Verify signature
  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, secret)

  if (!safeCompare(signature, expectedSignature)) {
    return null
  }

  // Decode payload
  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload))

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

/**
 * Decode a JWT token without verification
 * Useful for debugging or reading claims before verification
 *
 * @param {string} token - JWT token
 * @returns {Object|null} - Decoded payload or null if malformed
 */
export function decodeJwt(token) {
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    return JSON.parse(base64UrlDecode(parts[1]))
  } catch {
    return null
  }
}

/**
 * Create HMAC-SHA256 signature
 */
function sign(data, secret) {
  return base64UrlEncode(
    createHmac('sha256', secret).update(data).digest()
  )
}

/**
 * Base64URL encode (URL-safe base64)
 */
function base64UrlEncode(data) {
  const base64 = Buffer.isBuffer(data)
    ? data.toString('base64')
    : Buffer.from(data).toString('base64')

  return base64
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str) {
  // Add padding if needed
  const pad = str.length % 4
  const padded = pad ? str + '='.repeat(4 - pad) : str

  // Convert URL-safe chars back
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')

  return Buffer.from(base64, 'base64').toString('utf8')
}

/**
 * Timing-safe string comparison
 */
function safeCompare(a, b) {
  if (a.length !== b.length) {
    return false
  }

  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)

  return timingSafeEqual(bufA, bufB)
}

/**
 * Parse expiry string to seconds
 * Supports: 60 (seconds), '60s', '5m', '2h', '7d'
 */
function parseExpiry(expiry) {
  if (typeof expiry === 'number') {
    return expiry
  }

  const match = expiry.match(/^(\d+)(s|m|h|d)?$/)
  if (!match) {
    throw new Error(`Invalid expiry format: ${expiry}`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2] || 's'

  const multipliers = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 60 * 60 * 24
  }

  return value * multipliers[unit]
}
