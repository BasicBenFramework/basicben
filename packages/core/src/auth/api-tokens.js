/**
 * Long-lived API tokens, for programs rather than people.
 *
 * A user JWT is the wrong credential to hand a static site generator: it
 * carries a login, it expires on its own schedule, and it can do everything its
 * owner can. An API token is scoped, revocable on its own, and issued knowing
 * it will be pasted into someone's CI configuration.
 *
 * Tokens are `bb_` followed by 32 random bytes. The prefix is what lets one
 * `Authorization: Bearer` header carry either kind — middleware can route to
 * the right verifier without trying both and without a second header.
 *
 * Only a SHA-256 hash is stored, so a database leak does not hand over working
 * credentials. SHA-256 rather than scrypt is deliberate, for the same reason as
 * `tokens.js`: these are high-entropy secrets, so the slow-hash argument that
 * applies to guessable passwords does not, and verification is on every request.
 * Lookup is by hash against a unique index, so it is a single indexed read
 * rather than a scan comparing secrets — there is no byte-by-byte comparison for
 * a timing attack to walk.
 */

import { randomBytes, createHash } from 'node:crypto'
import { getDb } from '../db/index.js'

const TABLE = 'api_tokens'

export const TOKEN_PREFIX = 'bb_'

/**
 * The scopes a token may hold.
 *
 * Deliberately few. Every scope is a thing someone has to reason about when
 * issuing a credential, and a list nobody reads is a list where everything gets
 * ticked.
 */
export const SCOPES = {
  CONTENT_READ: 'content:read',
  CONTENT_WRITE: 'content:write',
  MEDIA_READ: 'media:read',
  MEDIA_WRITE: 'media:write'
}

const ALL_SCOPES = Object.values(SCOPES)

/**
 * Scopes that a held scope also grants.
 *
 * Writing implies reading. A token that can create a post but gets 403 reading
 * one back is the kind of API that makes people grant `*` instead.
 */
const IMPLIES = {
  [SCOPES.CONTENT_WRITE]: [SCOPES.CONTENT_READ],
  [SCOPES.MEDIA_WRITE]: [SCOPES.MEDIA_READ]
}

/**
 * Whether a string looks like an API token rather than a JWT.
 *
 * Used to pick a verifier, not to validate — a string passing this can still be
 * complete nonsense.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isApiToken(value) {
  return typeof value === 'string' && value.startsWith(TOKEN_PREFIX)
}

/**
 * Whether a set of held scopes grants a required one.
 *
 * @param {string[]} held
 * @param {string} required
 * @returns {boolean}
 */
export function hasScope(held, required) {
  if (!Array.isArray(held)) return false
  if (held.includes(required)) return true

  return held.some((scope) => IMPLIES[scope]?.includes(required))
}

/**
 * Reject unknown scopes at creation.
 *
 * A typo in a scope name would otherwise produce a token that authenticates and
 * then fails every authorization check, which reads as a broken API rather than
 * a bad token.
 *
 * @param {string[]} scopes
 * @returns {string[]} the scopes, de-duplicated
 */
function validateScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error(`A token needs at least one scope. Available: ${ALL_SCOPES.join(', ')}`)
  }

  const unknown = scopes.filter((scope) => !ALL_SCOPES.includes(scope))

  if (unknown.length > 0) {
    throw new Error(
      `Unknown scope${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. ` +
        `Available: ${ALL_SCOPES.join(', ')}`
    )
  }

  return [...new Set(scopes)]
}

/**
 * Issue a token and return the plaintext.
 *
 * The plaintext is returned exactly once and never stored. If it is lost, the
 * only remedy is issuing another — which is what every credential store worth
 * using does, and what makes the hash-only storage above meaningful.
 *
 * @param {number} userId
 * @param {Object} options
 * @param {string} options.name - what this token is for, shown in the UI
 * @param {string[]} options.scopes
 * @param {number} [options.ttl] - lifetime in ms; omit for a token that does not expire
 * @returns {Promise<{ token: string, id: number, name: string, scopes: string[], expiresAt: Date|null }>}
 */
export async function createApiToken(userId, options = {}) {
  const { name, scopes, ttl } = options

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('A token needs a name, so it can be recognised later and revoked')
  }

  const validated = validateScopes(scopes)
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  const expiresAt = ttl ? new Date(Date.now() + ttl) : null

  const db = await getDb()

  // created_at is written explicitly rather than left to the column default:
  // SQLite's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS", which does not compare
  // against the ISO-8601 strings everything else here stores.
  const result = await db.run(
    `INSERT INTO ${TABLE} (user_id, name, token_hash, scopes, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      name.trim(),
      hashApiToken(token),
      JSON.stringify(validated),
      expiresAt ? expiresAt.toISOString() : null,
      new Date().toISOString()
    ]
  )

  return {
    token,
    id: result.lastInsertRowid,
    name: name.trim(),
    scopes: validated,
    expiresAt
  }
}

/**
 * Verify a token, optionally requiring a scope.
 *
 * Returns null for anything not currently usable — unknown, expired, or lacking
 * the scope — rather than distinguishing them. The caller is an authentication
 * middleware, and telling an unauthenticated client *why* its credential failed
 * tells an attacker which of their guesses was a real token.
 *
 * @param {string} token
 * @param {string} [requiredScope]
 * @returns {Promise<{ id: number, userId: number, name: string, scopes: string[] }|null>}
 */
export async function verifyApiToken(token, requiredScope = null) {
  if (!isApiToken(token)) return null

  const db = await getDb()

  const row = await db.get(
    `SELECT id, user_id, name, scopes, expires_at FROM ${TABLE} WHERE token_hash = ?`,
    [hashApiToken(token)]
  )

  if (!row) return null

  if (row.expires_at && new Date(row.expires_at) <= new Date()) return null

  const scopes = safeParse(row.scopes) ?? []

  if (requiredScope && !hasScope(scopes, requiredScope)) return null

  await touch(db, row.id)

  return { id: row.id, userId: row.user_id, name: row.name, scopes }
}

/**
 * Record that a token was used, at most once a minute.
 *
 * "Last used" is worth having — it is how someone decides an old token is safe
 * to revoke — but a write on every request is not, and a read-heavy public API
 * is exactly where these get used. The conditional makes it a primary-key update
 * that usually matches no rows.
 */
async function touch(db, id, now = new Date()) {
  const threshold = new Date(now.getTime() - 60_000).toISOString()

  await db.run(
    `UPDATE ${TABLE} SET last_used_at = ?
     WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)`,
    [now.toISOString(), id, threshold]
  )
}

/**
 * A user's tokens, without anything secret.
 *
 * There is no way to recover a token's plaintext here, by design — the hash is
 * not returned either, since it is a verifier and handing it out would let a
 * reader of this list authenticate.
 *
 * @param {number} userId
 * @returns {Promise<Array<{ id: number, name: string, scopes: string[], lastUsedAt: string|null, expiresAt: string|null, createdAt: string }>>}
 */
export async function listApiTokens(userId) {
  const db = await getDb()

  const rows = await db.all(
    `SELECT id, name, scopes, last_used_at, expires_at, created_at
     FROM ${TABLE} WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    scopes: safeParse(row.scopes) ?? [],
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  }))
}

/**
 * Revoke a token.
 *
 * Scoped to the owner so one user cannot revoke another's by guessing an id.
 * The row is deleted rather than flagged: a revoked token has no further use,
 * and a list mixing live and dead credentials is one people stop reading.
 *
 * @param {number} id
 * @param {number} userId
 * @returns {Promise<boolean>} whether a token was revoked
 */
export async function revokeApiToken(id, userId) {
  const db = await getDb()
  const result = await db.run(`DELETE FROM ${TABLE} WHERE id = ? AND user_id = ?`, [id, userId])

  return (result.changes ?? 0) > 0
}

/**
 * Revoke every token belonging to a user.
 *
 * @param {number} userId
 * @returns {Promise<number>} rows deleted
 */
export async function revokeAllApiTokens(userId) {
  const db = await getDb()
  const result = await db.run(`DELETE FROM ${TABLE} WHERE user_id = ?`, [userId])

  return result.changes ?? 0
}

/**
 * Delete expired tokens.
 *
 * Nothing calls this automatically — there is no scheduler. Expired tokens are
 * refused by `verifyApiToken` regardless; this only keeps the table tidy.
 *
 * @returns {Promise<number>} rows deleted
 */
export async function pruneExpiredApiTokens() {
  const db = await getDb()
  const result = await db.run(
    `DELETE FROM ${TABLE} WHERE expires_at IS NOT NULL AND expires_at < ?`,
    [new Date().toISOString()]
  )

  return result.changes ?? 0
}

/**
 * SHA-256 of the token, hex encoded.
 *
 * @param {string} token
 * @returns {string}
 */
export function hashApiToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

function safeParse(json) {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
