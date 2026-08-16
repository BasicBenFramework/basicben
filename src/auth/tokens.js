/**
 * Short-lived credentials: email verification, password reset, and anything
 * else that arrives as an opaque string with an expiry.
 *
 * Tokens are 32 random bytes. Only a SHA-256 hash is stored, so a database leak
 * does not hand over working links. SHA-256 rather than scrypt is deliberate:
 * these are high-entropy secrets, so the slow-hash argument that applies to
 * passwords does not, and redemption is on a request path.
 */

import { randomBytes, createHash } from 'node:crypto'
import { getDb } from '../db/index.js'

export const TOKEN_KINDS = {
  EMAIL_VERIFICATION: 'email_verification',
  PASSWORD_RESET: 'password_reset'
}

const TABLE = 'auth_tokens'
const DEFAULT_TTL = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Issue a token and return the plaintext.
 *
 * The plaintext is returned exactly once and never stored. If it is lost, the
 * only remedy is issuing another.
 *
 * @param {number} userId
 * @param {string} kind
 * @param {Object} [options]
 * @param {number} [options.ttl] - lifetime in ms
 * @param {Object} [options.metadata] - stored as JSON alongside
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function issueToken(userId, kind, options = {}) {
  const db = await getDb()

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + (options.ttl ?? DEFAULT_TTL))

  // created_at is written explicitly rather than left to the column default:
  // SQLite's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS", which does not compare
  // against an ISO-8601 string, and the cooldown check does exactly that.
  await db.run(
    `INSERT INTO ${TABLE} (user_id, kind, token_hash, metadata, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      kind,
      hashToken(token),
      options.metadata ? JSON.stringify(options.metadata) : null,
      expiresAt.toISOString(),
      new Date().toISOString()
    ]
  )

  return { token, expiresAt }
}

/**
 * Redeem a token, consuming it.
 *
 * Returns null for anything not currently valid — unknown, wrong kind, expired,
 * or already used — rather than distinguishing them, since the caller has no
 * safe use for the difference.
 *
 * @param {string} token
 * @param {string} kind
 * @returns {Promise<{ userId: number, metadata: Object|null }|null>}
 */
export async function redeemToken(token, kind) {
  if (!token || typeof token !== 'string') return null

  const db = await getDb()
  const hash = hashToken(token)
  const now = new Date().toISOString()

  // Claiming the token is a single conditional UPDATE rather than a read
  // followed by a write. That makes it atomic on every driver — two concurrent
  // requests cannot both see used_at IS NULL and both proceed — without needing
  // a transaction, which a single SQLite connection could not isolate anyway.
  const claim = await db.run(
    `UPDATE ${TABLE} SET used_at = ?
     WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?`,
    [now, hash, kind, now]
  )

  if ((claim.changes ?? 0) !== 1) return null

  const row = await db.get(
    `SELECT user_id, metadata FROM ${TABLE} WHERE token_hash = ? AND kind = ?`,
    [hash, kind]
  )

  if (!row) return null

  return {
    userId: row.user_id,
    metadata: row.metadata ? safeParse(row.metadata) : null
  }
}

/**
 * Invalidate every outstanding token of a kind for a user.
 *
 * Called when the underlying fact changes — a verified address, a reset
 * password — so an older link cannot still be used.
 *
 * @param {number} userId
 * @param {string} kind
 * @returns {Promise<number>} rows affected
 */
export async function revokeTokens(userId, kind) {
  const db = await getDb()
  const result = await db.run(
    `UPDATE ${TABLE} SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL`,
    [new Date().toISOString(), userId, kind]
  )
  return result.changes ?? 0
}

/**
 * Whether a live token was issued recently.
 *
 * The framework has no rate limiter, and resend is an outbound-mail trigger, so
 * the token table doubles as the cooldown — no new infrastructure required.
 *
 * @param {number} userId
 * @param {string} kind
 * @param {number} withinMs
 * @returns {Promise<boolean>}
 */
export async function hasRecentToken(userId, kind, withinMs) {
  const db = await getDb()
  const since = new Date(Date.now() - withinMs).toISOString()

  const row = await db.get(
    `SELECT id FROM ${TABLE}
     WHERE user_id = ? AND kind = ? AND used_at IS NULL AND created_at > ?
     LIMIT 1`,
    [userId, kind, since]
  )

  return Boolean(row)
}

/**
 * Delete expired and used tokens.
 *
 * Nothing calls this automatically — there is no scheduler. Run it from a cron
 * or an admin action.
 *
 * @param {Object} [options]
 * @param {number} [options.keepUsedFor] - retain used rows this long, for audit
 * @returns {Promise<number>} rows deleted
 */
export async function pruneExpiredTokens(options = {}) {
  const db = await getDb()
  const cutoff = new Date(Date.now() - (options.keepUsedFor ?? 0)).toISOString()

  // <= rather than <: with keepUsedFor at 0 the cutoff is now, and a row used
  // in the same millisecond would otherwise survive every prune.
  const result = await db.run(
    `DELETE FROM ${TABLE} WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at <= ?)`,
    [new Date().toISOString(), cutoff]
  )

  return result.changes ?? 0
}

/**
 * SHA-256 of the token, hex encoded.
 *
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

function safeParse(json) {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
