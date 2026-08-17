/**
 * Authentication for the public content API.
 *
 * One `Authorization: Bearer` header carries either a user JWT or an API token,
 * told apart by the `bb_` prefix rather than by trying both verifiers. Trying
 * both would mean a failed JWT verification on every token request and a
 * database lookup on every session request, and it would make the failure
 * message depend on which verifier happened to run last.
 *
 * What each grants is deliberately different. An API token has scopes; a
 * session has a role. A route that needs a capability check wants the session
 * (see `requireSession`), because a token has no role to check.
 */

import { verifyJwt } from '@basicbenframework/core/auth'
import { DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'
import { isApiToken, verifyApiToken } from '@basicbenframework/core/auth/api-tokens'
// The extension is required. Everything in src/middleware is imported by the
// middleware autoloader through Node's own `import()`, which does no extension
// guessing — Vite resolves it either way, so without this the file works in the
// bundle and fails to load at boot, reported and skipped.
import { Settings } from '../models/Settings.ts'
import type { Request, Response } from '../types'

interface JwtPayload {
  userId: number
  role?: string
  email_verified?: boolean
}

type Next = () => void

function bearer(req: Request): string | null {
  const header = req.headers.authorization

  if (!header || !header.startsWith('Bearer ')) return null

  return header.slice('Bearer '.length).trim() || null
}

/**
 * Whether the site serves its content API without a credential.
 *
 * Off by default. A CMS that starts life publishing its whole database to
 * anonymous readers is a surprise, and the admin API next door already requires
 * auth — an unauthenticated public API would be the odd one out, not the norm.
 */
async function publicReadsAllowed(): Promise<boolean> {
  return Settings.getTyped('public_api', false)
}

/**
 * Require a credential granting `scope`, from either a token or a session.
 *
 * A logged-in user passes without holding a scope: scopes constrain programs
 * that were handed a credential, not people who signed in, and a session
 * already carries a role that the capability system checks separately.
 */
export const requireScope =
  (scope: string) => async (req: Request, res: Response, next: Next) => {
    const credential = bearer(req)

    if (credential && isApiToken(credential)) {
      const token = await verifyApiToken(credential, scope)

      if (!token) {
        return res.json({ error: 'Invalid or insufficiently scoped token' }, 401)
      }

      req.userId = token.userId
      req.apiToken = { id: token.id, name: token.name, scopes: token.scopes }

      return next()
    }

    if (credential) {
      const payload = verifyJwt(credential, process.env.APP_KEY as string) as JwtPayload | null

      if (payload) {
        req.userId = payload.userId
        req.user = {
          id: payload.userId,
          role: payload.role ?? DEFAULT_ROLE,
          email_verified: payload.email_verified ?? true
        }

        return next()
      }
    }

    // No usable credential. Anonymous reads are allowed only if the site has
    // opted in, and only for reads — `requireScope` is never applied to a
    // mutating route without a session check in front of it.
    if (await publicReadsAllowed()) {
      return next()
    }

    return res.json(
      {
        error: 'Unauthorized',
        hint: 'Send an API token as "Authorization: Bearer bb_...", or enable public reads in settings.'
      },
      401
    )
  }

/**
 * Refuse an API token, requiring a real session.
 *
 * Used on token management itself. Without it a leaked read-only token could
 * mint a write-scoped one and scopes would be decorative.
 */
export const requireSession = (req: Request, res: Response, next: Next) => {
  if (req.apiToken) {
    return res.json({ error: 'This endpoint requires a signed-in session, not an API token' }, 403)
  }

  next()
}
