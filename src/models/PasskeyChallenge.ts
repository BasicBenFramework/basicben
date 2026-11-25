import { createHash, randomBytes } from 'node:crypto'
import { getDb } from '@basicbenframework/core/db'

/**
 * A WebAuthn challenge with no user behind it yet: passwordless sign-in
 * (db/migrations/045). The handle goes to the browser and comes back with the
 * authenticator's answer; it can be redeemed once, before it expires.
 */

const hash = (handle: string) => createHash('sha256').update(handle).digest('hex')

export const PasskeyChallenge = {
  async issue(challenge: string, ttl: number): Promise<string> {
    const db = await getDb()
    const now = new Date()
    // Expired and spent rows are of no use to anyone, so each new one clears them.
    await db.run('DELETE FROM passkey_challenges WHERE expires_at < ? OR used_at IS NOT NULL', [now.toISOString()])

    const handle = randomBytes(32).toString('base64url')
    await db.run(
      'INSERT INTO passkey_challenges (handle_hash, challenge, expires_at) VALUES (?, ?, ?)',
      [hash(handle), challenge, new Date(now.getTime() + ttl).toISOString()]
    )
    return handle
  },

  /** The challenge, once: a conditional UPDATE, so two requests cannot both claim it. */
  async redeem(handle: unknown): Promise<string | null> {
    if (!handle || typeof handle !== 'string') return null
    const db = await getDb()
    const now = new Date().toISOString()
    const claim = await db.run(
      'UPDATE passkey_challenges SET used_at = ? WHERE handle_hash = ? AND used_at IS NULL AND expires_at > ?',
      [now, hash(handle), now]
    )
    if ((claim.changes ?? 0) !== 1) return null
    const row = await db.get('SELECT challenge FROM passkey_challenges WHERE handle_hash = ?', [hash(handle)])
    return (row as { challenge?: string } | undefined)?.challenge ?? null
  }
}
