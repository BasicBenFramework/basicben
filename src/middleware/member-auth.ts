/**
 * Member sessions on a request.
 *
 * Readers signed in with a magic link carry a member session (see
 * helpers/member-auth.ts). It is never an admin credential and nothing here
 * sets `req.user` or `req.userId` — those belong to `auth`, and a route that
 * checks them cannot be satisfied by a member whatever this file does.
 *
 * Where the token is read from:
 *
 * - `X-Member-Token: <token>` — always. This is the header for content reads,
 *   where `Authorization` already carries the site's own `content:read` token.
 * - `Authorization: Bearer <token>` — as well, but only when it verifies as a
 *   member session. That lets a browser call the member endpoints with the
 *   usual bearer header; an admin JWT or an API token there is simply not a
 *   member token and is ignored by this file.
 *
 * No cookies, deliberately: front ends are on other origins, and a bearer
 * header carries no ambient authority a cross-site request could borrow.
 *
 * Named exports only — a default export in src/middleware is applied to every
 * route by the framework's autoloader. Relative imports carry `.ts` for the
 * same autoloader, which uses Node's own `import()`.
 */

import { readMemberSession, MEMBER_HEADER } from '../helpers/member-auth.ts'
import { Member, type MemberRow } from '../models/Member.ts'
import type { Request, Response } from '../types'

type Next = () => void

/** The member token on a request, if it carries one. Unverified. */
export function memberToken(req: Request): string | null {
  const header = req.headers?.[MEMBER_HEADER]
  if (typeof header === 'string' && header.trim()) return header.trim()

  const authorization = req.headers?.authorization
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const candidate = authorization.slice(7).trim()
    // Only claimed if it really is one: the same header carries admin
    // sessions and API tokens, which are not ours to refuse.
    if (readMemberSession(candidate)) return candidate
  }

  return null
}

/**
 * The member a token belongs to, as their row stands now. Null otherwise.
 *
 * The row is read on every use, for the reason `auth` reads the account row:
 * a deleted member, or one who signed out everywhere, stops working on the
 * next request rather than when the token happens to expire.
 */
export async function resolveMember(token: string | null): Promise<MemberRow | null> {
  const claims = readMemberSession(token)
  if (!claims) return null

  const member = await Member.find(claims.mid)
  if (!member || Number(member.session_version ?? 0) !== claims.sv) return null

  return member
}

/** The member behind a request, or null. For controllers outside a member route. */
export async function memberFromRequest(req: Request): Promise<MemberRow | null> {
  if (req.member !== undefined) return req.member ?? null
  const member = await resolveMember(memberToken(req))
  req.member = member
  return member
}

/**
 * Identify the member if there is one, and carry on either way.
 *
 * For reads that are served to everyone but serve members more — a gated
 * post's body. A bad or revoked token is treated as none: the request was
 * allowed without one, and a reader whose session ended sees what anyone sees.
 */
export const optionalMember = async (req: Request, _res: Response, next: Next) => {
  const member = await memberFromRequest(req)
  if (member) await Member.touch(member).catch(() => {})
  next()
}

/** Require a member session. */
export const requireMember = async (req: Request, res: Response, next: Next) => {
  const member = await memberFromRequest(req)

  if (!member) {
    return res.json({ error: 'Not signed in', hint: 'Send the member session as "X-Member-Token: <token>".' }, 401)
  }

  await Member.touch(member).catch(() => {})
  next()
}
