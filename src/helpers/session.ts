import { signJwt } from '@basicbenframework/core/auth'
import { DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'
import { getDb } from '@basicbenframework/core/db'

/** What a session token carries. */
export interface SessionClaims {
  userId: number
  role?: string
  email_verified?: boolean
  /** The account's `token_version` when this token was issued. */
  tv?: number
}

/** The account fields a session is built from. */
interface SessionUser {
  id: number
  role?: string | null
  email_verified?: number | boolean | null
  token_version?: number | null
}

/**
 * Mint a session token.
 *
 * The one place tokens are issued, so every one carries the account's token
 * version — a token minted without it could never be revoked.
 */
export function issueSessionToken(user: SessionUser): string {
  return signJwt(
    {
      userId: user.id,
      role: user.role ?? DEFAULT_ROLE,
      email_verified: Boolean(user.email_verified),
      tv: Number(user.token_version ?? 0)
    },
    process.env.APP_KEY as string,
    { expiresIn: '7d' }
  )
}

/**
 * End every session an account has.
 *
 * Tokens issued before this call carry the old version and stop verifying on
 * their next request.
 */
export async function revokeSessions(userId: number): Promise<void> {
  const db = await getDb()
  await db.run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId])
}
