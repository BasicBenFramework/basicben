/**
 * Authentication for the public content API and the Admin API.
 *
 * One `Authorization: Bearer` header carries either a user JWT or an API token,
 * told apart by the `bb_` prefix rather than by trying both verifiers. Trying
 * both would mean a failed JWT verification on every token request and a
 * database lookup on every session request, and it would make the failure
 * message depend on which verifier happened to run last.
 *
 * What each grants is deliberately different. An API token has scopes; a
 * session has a role. On the read API a token's scope is the whole check. On
 * the Admin API (`authOrToken`) a token acts as its owner, so the owner's role
 * is checked as well and the scope only ever narrows it.
 */

import { hasScope, isApiToken, verifyApiToken } from '@basicbenframework/core/auth/api-tokens'
// The extension is required. Everything in src/middleware is imported by the
// middleware autoloader through Node's own `import()`, which does no extension
// guessing — Vite resolves it either way, so without this the file works in the
// bundle and fails to load at boot, reported and skipped.
import { Settings } from '../models/Settings.ts'
import { resolveSession, accountForToken } from './auth.ts'
import { tokenWriteLimiter } from './rate-limits.ts'
import type { Request, Response } from '../types/index.ts'

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
 *
 * Both branches read the account row, the same way `auth` does. The session
 * branch used to trust the JWT's own claims — its role and its verification
 * flag — so a session that had been signed out everywhere, or belonged to a
 * disabled account, kept working here for the rest of its seven days, with
 * whatever role it had at sign-in. A token whose owner has been disabled is
 * refused for the same reason: it acts as that person.
 */
export const requireScope =
  (scope: string) => async (req: Request, res: Response, next: Next) => {
    const credential = bearer(req)

    if (credential && isApiToken(credential)) {
      const token = await verifyApiToken(credential, scope)
      const owner = token ? await accountForToken(token.userId) : null

      // One message for an unknown token, an under-scoped one and one whose
      // owner can no longer sign in: telling them apart tells a guesser which
      // of their strings was real.
      if (!token || !owner) {
        return res.json({ error: 'Invalid or insufficiently scoped token' }, 401)
      }

      req.userId = token.userId
      req.apiToken = { id: token.id, name: token.name, scopes: token.scopes }

      return next()
    }

    if (credential) {
      const session = await resolveSession(credential)

      if (session.ok) {
        req.userId = session.userId
        req.user = session.user

        return next()
      }
    }

    // No usable credential — absent, malformed, expired or revoked. Anonymous
    // reads are allowed only if the site has opted in, and only for reads —
    // `requireScope` is never applied to a mutating route without a session
    // check in front of it. A revoked session falling through to anonymous
    // gains nothing by it: it sees what anyone sees.
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
 * The Admin API: a session, or an API token holding `scope`.
 *
 * Used in place of `auth` on the admin routes a program may drive — creating
 * and editing posts, tags and categories, uploading media. Everything after it
 * (capability checks, ownership, the publish rule) runs unchanged, because
 * with a token `req.user` is the token *owner's* account as it stands now: its
 * current role, its verification, refused if disabled. A token therefore never
 * exceeds the person who issued it, and the scope narrows it further — an
 * admin's `content:write` token can write posts and still cannot touch users
 * or settings, which stay behind `auth` and refuse tokens outright.
 *
 * With a token, `req.apiToken` is set, which is what lets a controller treat a
 * program differently from a person (permanent deletion, the edit lock), and
 * what `requireSession` keys on. Every token write is counted against the
 * token's own budget, answered with an `X-BasicBen-Token-Id` header, and
 * logged with the token id, so a change made by a program can be traced to the
 * credential that made it rather than only to the person who owns it.
 */
export const authOrToken =
  (scope: string) => async (req: Request, res: Response, next: Next) => {
    const credential = bearer(req)

    if (!credential) {
      return res.json({ error: 'Unauthorized' }, 401)
    }

    if (!isApiToken(credential)) {
      const session = await resolveSession(credential)
      if (!session.ok) return res.json(session.body, session.status)

      req.userId = session.userId
      req.user = session.user
      return next()
    }

    // Verified without the scope first, so that a real token which simply
    // lacks it can be told so. Its holder already has the token; saying it is
    // valid tells them nothing new, and "invalid token" for a working read
    // token sends people looking for the wrong problem.
    const token = await verifyApiToken(credential)
    const owner = token ? await accountForToken(token.userId) : null

    if (!token || !owner) {
      return res.json({ error: 'Invalid token' }, 401)
    }

    if (!hasScope(token.scopes, scope)) {
      return res.json({ error: `This token does not hold the ${scope} scope` }, 403)
    }

    const method = String((req as unknown as { method?: string }).method ?? 'GET').toUpperCase()

    if (method !== 'GET' && method !== 'HEAD') {
      const limit = await tokenWriteLimiter.consume(`api-token:${token.id}`)

      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfter))
        return res.json(
          { error: 'Too many writes with this token. Please slow down.', retryAfter: limit.retryAfter },
          429
        )
      }

      // The audit line. A log rather than a table: it costs nothing on the
      // request, every host already collects stdout, and the hooks that fire
      // on each write receive `req` — so a site that wants a durable trail can
      // record `req.apiToken` wherever it likes from a listener.
      const url = String((req as unknown as { url?: string }).url ?? '')
      console.info(`[admin-api] token ${token.id} "${token.name}" (user ${token.userId}) ${method} ${url}`)
    }

    res.setHeader('X-BasicBen-Token-Id', String(token.id))

    req.userId = token.userId
    req.user = owner
    req.apiToken = { id: token.id, name: token.name, scopes: token.scopes }

    next()
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
