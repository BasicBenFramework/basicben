/**
 * Credentials for members: sessions, magic links and unsubscribe links.
 *
 * ## A member session can never be an admin session
 *
 * Admin sessions are JWTs signed with APP_KEY and carrying `userId`; `auth`
 * verifies with APP_KEY and reads that claim. A member session is signed with
 * a *different key*, derived from APP_KEY for this one purpose, and carries
 * `mid` instead of `userId` plus an `aud` naming it a member token. So:
 *
 * - `auth` / `resolveSession` fail its signature check (different key) and
 *   answer "Invalid token" — the claims are never even read;
 * - even a hypothetical key collision would leave `userId` undefined, which
 *   reads no account;
 * - the reverse holds too: an admin JWT fails `readMemberSession`.
 *
 * `tests/phase3-members.test.js` proves the first and the last.
 *
 * ## Why derived keys
 *
 * The same reason `comment-guard.ts` derives its own: APP_KEY signs sessions,
 * and every other kind of token signed with it is a token that might be
 * replayed as one. Deriving per purpose also means an unsubscribe token cannot
 * be presented as a session, or the reverse.
 *
 * ## Magic links
 *
 * Random, single-use and stored hashed in `member_tokens` — not a stateless
 * JWT. A signed link would be replayable until it expired; a row can be
 * claimed exactly once, by the conditional UPDATE that `redeemToken` in the
 * framework uses for password resets.
 */

import { createHmac, createHash, randomBytes } from 'node:crypto'
import { signJwt, verifyJwt } from '@basicbenframework/core/auth'
import { appKey } from '@basicbenframework/core/server'
import { getDb } from '@basicbenframework/core/db'

/** The audience a member session names. Checked on every read. */
export const MEMBER_AUDIENCE = 'basicben:member'

/** How long a member stays signed in. Readers expect "remember me", not a daily login. */
export const MEMBER_SESSION_TTL = '30d'

/** How long a magic link works. Long enough to find the mail; short enough to be useless later. */
export const MAGIC_LINK_TTL_MS = 60 * 60 * 1000

/**
 * The header a member session travels in on content reads.
 *
 * Not `Authorization`, because on `/api/v1` that header is already taken by
 * the `content:read` token a front end authenticates *itself* with. The two
 * are different parties — the site, and the reader using it — and a request
 * routinely carries both. The member endpoints themselves accept either.
 */
export const MEMBER_HEADER = 'x-member-token'

function keyFor(purpose: string): string {
  return createHmac('sha256', appKey('member sessions'))
    .update(`basicben.members.${purpose}`)
    .digest('hex')
}

export interface MemberSessionClaims {
  mid: number
  /** The member's `session_version` when this was issued. */
  sv: number
  aud: string
}

/** Mint a member session. */
export function issueMemberSession(member: { id: number; session_version?: number | null }): string {
  return signJwt(
    { mid: Number(member.id), sv: Number(member.session_version ?? 0), aud: MEMBER_AUDIENCE },
    keyFor('session'),
    { expiresIn: MEMBER_SESSION_TTL }
  )
}

/**
 * The claims of a member session, or null.
 *
 * Signature, expiry and audience. Whether the member still exists and the
 * session has not been signed out is the caller's question — it needs the row.
 */
export function readMemberSession(token: unknown): MemberSessionClaims | null {
  if (typeof token !== 'string' || !token || token.startsWith('bb_')) return null

  const payload = verifyJwt(token, keyFor('session')) as Partial<MemberSessionClaims> | null
  if (!payload || payload.aud !== MEMBER_AUDIENCE) return null

  const mid = Number(payload.mid)
  if (!Number.isInteger(mid) || mid <= 0) return null

  return { mid, sv: Number(payload.sv ?? 0), aud: MEMBER_AUDIENCE }
}

/**
 * A link that unsubscribes one member from newsletters.
 *
 * No expiry: an unsubscribe link has to work in a mail opened a year later,
 * and the most it can do is stop mail — the same reasoning, and the same
 * shape, as the comment reply unsubscribe in comment-guard.ts.
 */
export function issueMemberUnsubscribeToken(memberId: number): string {
  return signJwt({ m: Number(memberId) }, keyFor('unsubscribe'))
}

/** The member an unsubscribe token names, or null. */
export function readMemberUnsubscribeToken(token: unknown): number | null {
  if (typeof token !== 'string' || !token) return null
  const payload = verifyJwt(token, keyFor('unsubscribe')) as { m?: unknown } | null
  const id = Number(payload?.m)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** One normal form for an address, so the unique index means one mailbox. */
export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export interface MagicLinkPayload {
  /** Null for a sign-up: there is no member yet. */
  memberId: number | null
  email: string
  metadata: { name?: string | null; newsletter?: boolean } | null
}

/**
 * Issue a magic link for an address, revoking any earlier unused one.
 *
 * Only the newest link works — someone who asked twice and clicks the older
 * mail should not be signed in by a link they may have forwarded.
 */
export async function issueMagicLink(payload: MagicLinkPayload): Promise<string> {
  const db = await getDb()
  const email = normalizeEmail(payload.email)
  const now = new Date().toISOString()

  await db.run('UPDATE member_tokens SET used_at = ? WHERE email = ? AND used_at IS NULL', [now, email])

  const token = randomBytes(32).toString('base64url')

  await db.run(
    `INSERT INTO member_tokens (member_id, email, token_hash, metadata, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      payload.memberId,
      email,
      hash(token),
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString(),
      now
    ]
  )

  return token
}

/**
 * Spend a magic link. Null for anything not currently valid.
 *
 * Unknown, expired and already-used are one answer: the caller has no safe
 * use for the difference, and telling them apart helps only a guesser.
 */
export async function redeemMagicLink(token: unknown): Promise<MagicLinkPayload | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null

  const db = await getDb()
  const tokenHash = hash(token)
  const now = new Date().toISOString()

  // One conditional UPDATE: atomic on every driver, so two requests racing
  // with the same link cannot both get a session.
  const claim = await db.run(
    'UPDATE member_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
    [now, tokenHash, now]
  )

  if (Number(claim?.changes ?? 0) !== 1) return null

  const row = (await db.get(
    'SELECT member_id, email, metadata FROM member_tokens WHERE token_hash = ?',
    [tokenHash]
  )) as { member_id: number | null; email: string; metadata: string | null } | undefined

  if (!row) return null

  let metadata: MagicLinkPayload['metadata'] = null
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : null
  } catch {
    metadata = null
  }

  return { memberId: row.member_id === null ? null : Number(row.member_id), email: row.email, metadata }
}

/** Delete links that can no longer be used. Called opportunistically by the newsletter cron. */
export async function pruneMagicLinks(): Promise<void> {
  const db = await getDb()
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  await db.run('DELETE FROM member_tokens WHERE expires_at < ?', [cutoff])
}
