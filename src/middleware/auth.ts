import { verifyJwt } from '@basicbenframework/core/auth'
import { DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'
import { isApiToken } from '@basicbenframework/core/auth/api-tokens'
import { getDb } from '@basicbenframework/core/db'
import type { SessionClaims } from '../helpers/session.ts'
import type { Request, Response } from '../types/index.ts'

interface AccountState {
  role: string | null
  email_verified: number | null
  token_version: number | null
  disabled_at: string | null
}

/** The request user, as every capability check reads it. */
export interface CurrentUser {
  id: number
  role: string
  email_verified: boolean
}

export type Resolved =
  | { ok: true; userId: number; user: CurrentUser }
  | { ok: false; status: number; body: Record<string, unknown> }

async function readAccount(userId: number): Promise<AccountState | undefined> {
  const db = await getDb()
  return (await db.get(
    'SELECT role, email_verified, token_version, disabled_at FROM users WHERE id = ?',
    [userId]
  )) as AccountState | undefined
}

function currentUser(userId: number, account: AccountState): CurrentUser {
  return {
    id: userId,
    role: account.role ?? DEFAULT_ROLE,
    // Absent means verified: rows created before verification existed have
    // no value, and treating that as unverified would lock everyone out.
    email_verified: account.email_verified === null || account.email_verified === undefined
      ? true
      : Boolean(account.email_verified)
  }
}

/**
 * The account behind an API token, as it stands now.
 *
 * A token carries no role of its own — it acts as its owner — so the owner's
 * row is read on every use for the same reason a session's is: a disabled
 * account's tokens stop working on their next request, and a demoted owner's
 * token is demoted with them. Token version is deliberately not compared:
 * "sign out everywhere" ends sessions, and tokens are revoked on their own
 * screen (or all at once when an admin disables the account).
 *
 * Null when there is no usable account behind it.
 */
export async function accountForToken(userId: number): Promise<CurrentUser | null> {
  const account = await readAccount(userId)
  if (!account || account.disabled_at) return null
  return currentUser(userId, account)
}

/**
 * Turn a bearer token into the signed-in user, or say why not.
 *
 * The token proves who is asking; the account row decides what they may do.
 * Reading the row on every request is what makes a session revocable — a
 * signed-out, disabled or demoted account stops working on its next request
 * rather than when its token happens to expire — and it means the role checked
 * is the role the account has now, not the one it had at sign-in.
 */
export async function resolveSession(token: string): Promise<Resolved> {
  // An API token can never verify as a JWT, so this would refuse one anyway —
  // but "Invalid token" for a credential that is perfectly valid elsewhere
  // reads as a bug in the token rather than a rule about this route.
  if (isApiToken(token)) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'This endpoint requires a signed-in session, not an API token',
        hint: 'API tokens work on /api/v1/* and on the Admin API write routes (docs/admin-api.md). This one requires logging in.'
      }
    }
  }

  const payload = verifyJwt(token, process.env.APP_KEY as string) as SessionClaims | null
  if (!payload) {
    return { ok: false, status: 401, body: { error: 'Invalid token' } }
  }

  const account = await readAccount(payload.userId)

  // Tokens from before versioning carry no `tv`; they match version 0, which
  // every account starts at, so a deploy signs nobody out.
  const tokenVersion = Number(payload.tv ?? 0)

  if (!account || account.disabled_at || Number(account.token_version ?? 0) !== tokenVersion) {
    return { ok: false, status: 401, body: { error: 'Session expired. Please sign in again.' } }
  }

  return { ok: true, userId: payload.userId, user: currentUser(payload.userId, account) }
}

function bearer(req: Request): string | undefined {
  const header = req.headers.authorization
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined
}

// Named exports only, deliberately. The framework applies any DEFAULT export
// from src/middleware/*.js to every route, which would 401 the whole site
// including the login endpoint.
export const auth = async (req: Request, res: Response, next: () => void) => {
  const token = bearer(req)
  if (!token) {
    return res.json({ error: 'Unauthorized' }, 401)
  }

  const result = await resolveSession(token)
  if (!result.ok) {
    return res.json(result.body, result.status)
  }

  req.userId = result.userId
  req.user = result.user
  next()
}

/**
 * Identify the caller if they are signed in, and carry on either way.
 *
 * For routes anyone may use but a signed-in user uses differently — posting a
 * comment as yourself rather than as a guest, or a moderator seeing the queue.
 * A bad token is treated as no token rather than refused: the request was
 * allowed without one.
 */
export const optionalAuth = async (req: Request, _res: Response, next: () => void) => {
  const token = bearer(req)
  if (token) {
    const result = await resolveSession(token)
    if (result.ok) {
      req.userId = result.userId
      req.user = result.user
    }
  }
  next()
}
