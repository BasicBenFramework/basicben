/**
 * Keeping spam out of the comments without a third-party service.
 *
 * Comments are the one write any visitor can make without an account, so they
 * are what every bot on the internet aims at. A hosted spam filter would mean
 * a dependency and sending every reader's words to someone else; these are
 * the cheap checks that catch the bulk of it, in order of how sure they are:
 *
 * - **A honeypot.** A field a person never sees and a form-filling bot cannot
 *   resist. Filled in means a machine, and the comment goes to spam.
 * - **A signed timestamp.** The form is handed a token saying when it was
 *   loaded. A submission back within a few seconds was not typed by anyone.
 *   The token is an HMAC, so there is no state to keep and nothing for a bot
 *   to forge without APP_KEY.
 * - **A blocklist** the site owner maintains: words, addresses, domains and
 *   IP ranges. A match goes to spam.
 * - **Too many links**, which is what most spam is for. That one is only held
 *   for a person to look at, since plenty of real comments cite sources.
 *
 * Everything here is pure — no database, no request — so it can be tested
 * directly and the controller decides what to do with the verdict.
 */

import { createHmac } from 'node:crypto'
import { BlockList, isIP } from 'node:net'
import { signJwt, verifyJwt } from '@basicbenframework/core/auth'
import { appKey } from '@basicbenframework/core/server'

/**
 * How deep replies may nest: a comment, a reply to it, and a reply to that.
 *
 * Three, not WordPress's five. Every level indents, and on a phone-width
 * column the fourth level leaves a sliver of text; past three a thread is
 * almost always two people going back and forth, which reads better flat
 * anyway. It also bounds the walk up the parent chain to a couple of queries.
 */
export const MAX_DEPTH = 3

/**
 * The fastest a person can plausibly read a post and write a comment.
 *
 * Deliberately low: a reader who wrote their reply in a text editor and
 * pasted it is still a reader. Bots submit in milliseconds.
 */
export const MIN_SUBMIT_MS = 3_000

/**
 * How long a form token stays fresh.
 *
 * A day covers a tab left open overnight. An older token is not evidence of a
 * bot — only of an old tab — so it holds the comment for moderation rather
 * than marking it spam.
 */
export const FORM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/** The honeypot's field name. Named like a field bots expect to fill. */
export const HONEYPOT_FIELD = 'website'

/** Links allowed before a comment is held, when the setting is absent. */
export const DEFAULT_MAX_LINKS = 2

export type CommentStatus = 'pending' | 'approved' | 'spam' | 'trash'
export const COMMENT_STATUSES: CommentStatus[] = ['pending', 'approved', 'spam', 'trash']

export function isCommentStatus(value: unknown): value is CommentStatus {
  return typeof value === 'string' && (COMMENT_STATUSES as string[]).includes(value)
}

/**
 * A signing key for one purpose, derived from APP_KEY.
 *
 * Never APP_KEY itself: that key signs sessions, and a token minted for a
 * comment form must not be anything else. Deriving per purpose also means a
 * form token cannot be replayed as an unsubscribe token or the reverse.
 */
function keyFor(purpose: string): string {
  return createHmac('sha256', appKey('comment tokens'))
    .update(`basicben.comments.${purpose}`)
    .digest('hex')
}

/**
 * A token saying this form, for this post, was loaded now.
 *
 * Milliseconds in the payload rather than the JWT's own `iat`, which counts
 * whole seconds — too coarse for a three-second threshold.
 */
export function issueFormToken(postId: number, now = Date.now()): string {
  return signJwt({ p: Number(postId), t: now }, keyFor('form'))
}

export type FormTokenVerdict = 'ok' | 'missing' | 'invalid' | 'too_fast' | 'expired'

/**
 * What a submitted form token says about the submission.
 *
 * `missing` is its own answer, not `invalid`: comment forms written before
 * this existed — a headless front end, an old cached page — send none, and
 * they are owed moderation, not a spam verdict.
 */
export function checkFormToken(token: unknown, postId: number, now = Date.now()): FormTokenVerdict {
  if (token === undefined || token === null || token === '') return 'missing'
  if (typeof token !== 'string') return 'invalid'

  const payload = verifyJwt(token, keyFor('form')) as { p?: unknown; t?: unknown } | null
  if (!payload) return 'invalid'

  // A token for another post is a token harvested once and replayed.
  if (Number(payload.p) !== Number(postId)) return 'invalid'

  const issued = Number(payload.t)
  if (!Number.isFinite(issued) || issued > now + 60_000) return 'invalid'
  if (now - issued < MIN_SUBMIT_MS) return 'too_fast'
  if (now - issued > FORM_TOKEN_TTL_MS) return 'expired'

  return 'ok'
}

/**
 * A link that stops reply notifications for one comment.
 *
 * No expiry: an unsubscribe link must keep working in a mail opened a year
 * later. It can only ever turn notifications off, so a leaked one costs the
 * owner some emails they may not have wanted anyway.
 */
export function issueUnsubscribeToken(commentId: number): string {
  return signJwt({ c: Number(commentId) }, keyFor('unsubscribe'))
}

/** The comment an unsubscribe token names, or null if it is not one of ours. */
export function readUnsubscribeToken(token: unknown): number | null {
  if (typeof token !== 'string' || !token) return null
  const payload = verifyJwt(token, keyFor('unsubscribe')) as { c?: unknown } | null
  const id = Number(payload?.c)
  return Number.isInteger(id) && id > 0 ? id : null
}

export interface Blocklist {
  words: string[]
  emails: Set<string>
  domains: string[]
  addresses: BlockList
  /** How many address entries were added, so an empty list can skip the check. */
  addressCount: number
}

/**
 * Read the blocklist setting: one entry per line.
 *
 * Each line is taken as what it looks like —
 *
 * - `203.0.113.7`, `198.51.100.0/24`, `2001:db8::/32` — an address or a range
 * - `spammer@example.com` — one address; `@example.com` — the whole domain
 * - anything else — a word or phrase, matched case-insensitively anywhere in
 *   the comment, the name or the email
 *
 * Lines starting with `#` are notes. A malformed range is skipped rather than
 * thrown: one typo must not stop every comment on the site.
 *
 * IPv6 entries are widened to their /64. The rate limiter keys a client on its
 * /64 (one subscriber is routinely handed the whole range) and that is the
 * address the controller has to check, so a narrower entry could never match.
 */
export function parseBlocklist(text: string | null | undefined): Blocklist {
  const list: Blocklist = { words: [], emails: new Set(), domains: [], addresses: new BlockList(), addressCount: 0 }

  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const [base, prefixText] = line.split('/')
    const family = isIP(base)

    if (family) {
      const type = family === 4 ? 'ipv4' : 'ipv6'
      const max = family === 4 ? 32 : 64
      const prefix = prefixText === undefined ? max : Number(prefixText)
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) continue
      try {
        list.addresses.addSubnet(base, Math.min(prefix, max), type)
        list.addressCount++
      } catch {
        // Skipped, as above.
      }
      continue
    }

    const lower = line.toLowerCase()
    if (lower.startsWith('@')) list.domains.push(lower)
    else if (/^[^\s@]+@[^\s@]+$/.test(lower)) list.emails.add(lower)
    else list.words.push(lower)
  }

  return list
}

/**
 * Whether a client key — the rate limiter's normalised address — is listed.
 *
 * The key is an IPv4 address or an IPv6 `/64` written `a:b:c:d::/64`; the
 * network address stands for the range.
 */
function addressListed(list: Blocklist, key: string | null | undefined): boolean {
  if (!key || list.addressCount === 0) return false
  if (isIP(key) === 4) return list.addresses.check(key, 'ipv4')
  if (key.endsWith('::/64')) {
    const network = key.slice(0, -3)
    return isIP(network) === 6 && list.addresses.check(network, 'ipv6')
  }
  if (isIP(key) === 6) return list.addresses.check(key, 'ipv6')
  return false
}

export interface Submission {
  content: string
  name?: string | null
  email?: string | null
  ip?: string | null
}

/** Why a submission matches the blocklist, or null. */
export function matchBlocklist(list: Blocklist, submission: Submission): string | null {
  const email = String(submission.email ?? '').trim().toLowerCase()

  if (email && list.emails.has(email)) return 'blocklist: email'
  if (email && list.domains.some(domain => email.endsWith(domain))) return 'blocklist: email domain'
  if (addressListed(list, submission.ip)) return 'blocklist: address'

  if (list.words.length) {
    const haystack = `${submission.content}\n${submission.name ?? ''}\n${email}`.toLowerCase()
    if (list.words.some(word => haystack.includes(word))) return 'blocklist: word'
  }

  return null
}

/**
 * How many links a comment carries.
 *
 * Counts what a reader's mail client or the rendered page would turn into a
 * link — schemes and bare `www.` hosts — not every dot. Generous by design:
 * this only ever holds a comment for a person, it never discards one.
 */
export function countLinks(content: string): number {
  return (String(content).match(/\bhttps?:\/\/|\bwww\.[a-z0-9-]/gi) ?? []).length
}

export interface Verdict {
  /** Where the comment goes. `null` means no check objected. */
  status: 'spam' | 'pending' | null
  reason: string | null
}

/**
 * Run every check and return the strictest outcome.
 *
 * `trusted` skips the bot checks for a signed-in commenter: an account is
 * already a stronger signal than a hidden field, and a front end that signs
 * people in may not render the form these tokens come from. The blocklist and
 * the link count apply to everyone but moderators, whom the caller exempts.
 */
export function assess(input: {
  submission: Submission
  honeypot: unknown
  formToken: unknown
  postId: number
  blocklist: Blocklist
  maxLinks: number
  trusted: boolean
  now?: number
}): Verdict {
  if (!input.trusted) {
    if (input.honeypot !== undefined && input.honeypot !== null && String(input.honeypot).trim() !== '') {
      return { status: 'spam', reason: 'honeypot' }
    }

    const token = checkFormToken(input.formToken, input.postId, input.now)
    if (token === 'invalid') return { status: 'spam', reason: 'form token: invalid' }
    if (token === 'too_fast') return { status: 'spam', reason: 'form token: submitted too fast' }
  }

  const listed = matchBlocklist(input.blocklist, input.submission)
  if (listed) return { status: 'spam', reason: listed }

  if (!input.trusted) {
    const token = checkFormToken(input.formToken, input.postId, input.now)
    if (token === 'missing') return { status: 'pending', reason: 'form token: missing' }
    if (token === 'expired') return { status: 'pending', reason: 'form token: expired' }
  }

  const links = countLinks(input.submission.content)
  if (links > input.maxLinks) return { status: 'pending', reason: `links: ${links}` }

  return { status: null, reason: null }
}
