/**
 * Rate limits for the authentication endpoints and the public content API.
 *
 * Two shapes, because they stop different attacks.
 *
 * Limiting by address stops one attacker hammering many accounts. Limiting by
 * the account being targeted stops many addresses hammering one — which is what
 * a credential-stuffing run looks like, and what an address limit alone misses
 * entirely. Login has both.
 *
 * State lives in the database, not memory: a lockout that a restart clears, or
 * that a second instance cannot see, is not a lockout.
 */

import { rateLimit, createLimiter, clientAddress, DatabaseStore } from '@basicbenframework/core/rate-limit'
import { getDb } from '@basicbenframework/core/db'
import type { Request } from '../types/index.ts'

/** Shared with features' limiters (`host.rateLimit` would only wrap this). */
export const store = new DatabaseStore({ getDb })

// Set this when running behind a proxy that overwrites X-Forwarded-For.
// Leaving it off on a directly-exposed server is deliberate: the header is
// client-supplied, so trusting it would let anyone rotate their apparent
// address and bypass every limit here.
// `true` is one proxy; a number is that many, counted from the right of the
// header, which is the end the client cannot write.
const trustProxy: boolean | number =
  process.env.TRUST_PROXY === 'true' ? true
    : /^\d+$/.test(process.env.TRUST_PROXY ?? '') ? Number(process.env.TRUST_PROXY)
      : false

const address = (req: Request) => `ip:${(req as any).socket?.remoteAddress ?? ''}`
const emailKey = (req: Request) => {
  const email = (req.body as { email?: string })?.email
  return email ? `email:${String(email).toLowerCase()}` : null
}

export { address }

/**
 * The caller's address as every limiter here sees it.
 *
 * For checks that are not limits — the comment blocklist — but have to agree
 * with them about who a client is: the same proxy trust, and the same
 * normalisation (IPv4-mapped addresses as IPv4, IPv6 as its /64). Reading the
 * socket directly would let a blocked commenter behind a trusted proxy
 * through, and a raw IPv6 address would let them step around an entry by
 * changing the last 64 bits.
 */
export const clientIp = (req: Request): string => clientAddress(req, trustProxy)

/**
 * An address key in a namespace of its own.
 *
 * Nothing for an unidentifiable caller, as the framework's default key does:
 * one shared bucket for everyone without an address would let one of them
 * lock out the rest.
 */
export const addressIn = (namespace: string) => (req: Request) => {
  const ip = clientIp(req)
  return ip ? `${namespace}:${ip}` : null
}

// Every limiter below shares one store, so each keys into a namespace of its
// own. On the bare address they were one bucket: a visitor blocked for failed
// sign-ins was blocked from the content API, registration and password reset
// too, and traffic on one limiter spent the allowance of all the others.

/**
 * Password guessing from one address.
 *
 * Generous enough that someone mistyping their password a few times is
 * unaffected, and the counter is cleared on a successful sign-in.
 */
export const loginByAddress = rateLimit({
  limit: 10,
  window: '15m',
  blockFor: '15m',
  store,
  key: addressIn('login'),
  message: 'Too many sign-in attempts. Please try again shortly.'
})

/** The same account targeted from anywhere. */
export const loginByAccount = rateLimit({
  limit: 5,
  window: '15m',
  blockFor: '15m',
  store,
  key: emailKey,
  message: 'Too many sign-in attempts for this account. Please try again shortly.'
})

/** Account creation, which costs an email each time. */
export const registerLimit = rateLimit({
  limit: 5,
  window: '1h',
  store,
  key: addressIn('register'),
  message: 'Too many accounts created from here. Please try again later.'
})

/**
 * Second-factor codes.
 *
 * The per-user lockout in TwoFactorController is the primary control; this
 * catches an attacker cycling challenges from one address before that lockout
 * has anything to count.
 */
export const twoFactorLimit = rateLimit({
  limit: 20,
  window: '15m',
  blockFor: '15m',
  store,
  key: addressIn('two-factor'),
  message: 'Too many attempts. Please try again shortly.'
})

/**
 * Signing in with a passkey alone. A guess is not possible (the browser has to
 * produce a signature), so this only stops one address filling the challenge
 * table or spinning on the endpoint.
 */
export const passkeySignInLimit = rateLimit({
  limit: 30,
  window: '15m',
  blockFor: '15m',
  store,
  key: addressIn('passkey-sign-in'),
  message: 'Too many attempts. Please try again shortly.'
})

/**
 * Outbound email triggered by a caller.
 *
 * Used directly rather than as middleware, since the controller decides who the
 * subject is once it has resolved the user.
 */
export const emailSendLimiter = createLimiter({
  limit: 3,
  window: '15m',
  store
})

/**
 * The public content API.
 *
 * `/api/v1` is the one surface that can be served to anyone — `public_api` in
 * settings turns off the credential requirement — and it was the only route
 * file with no limit at all.
 *
 * ## Why this keys on the address and not the token
 *
 * Per-token buckets would be the better accounting: a build server on a shared
 * CI address gets its own budget rather than competing with everything else on
 * that egress IP. They are also not implementable here.
 *
 * A limiter has to run *before* authentication, or a flood of fabricated
 * tokens is never limited — `requireScope` refuses them and returns, so the
 * limiter downstream never sees the request, and each one has already cost an
 * indexed lookup. Running before authentication means the token is unverified,
 * and keying on an unverified string hands an attacker a fresh bucket per
 * fabricated token, which is worse than no limit because it looks like one.
 *
 * So: the address, always. The cost is that consumers sharing an egress IP
 * share a budget. The limit below is set high enough that this does not bite in
 * practice — a static build fetching a thousand posts at the maximum hundred
 * per page is ten requests.
 */
export const publicApiLimit = rateLimit({
  limit: 120,
  window: '1m',
  blockFor: '1m',
  store,
  key: addressIn('public-api'),
  message: 'Too many requests. Please slow down.'
})

/**
 * Account changes: the profile and the password.
 *
 * Both take a current password when they matter, which makes them a place to
 * guess one from inside a stolen session; and the profile answers whether an
 * address is taken. Keyed on the account, so it runs after `auth`.
 */
export const accountChangeLimit = rateLimit({
  limit: 10,
  window: '15m',
  blockFor: '15m',
  store,
  key: (req: Request) => `account:${req.userId ?? ''}`,
  message: 'Too many account changes. Please try again shortly.'
})

/**
 * Comments from anyone.
 *
 * The one write any visitor can make without an account, so the one most
 * worth flooding.
 */
export const commentLimit = rateLimit({
  limit: 5,
  window: '10m',
  blockFor: '10m',
  store,
  // Prefixed. Every limiter here shares one store, and one left on the bare
  // address shares its bucket with every other bare-address limiter: a reader
  // who posted five comments was locked out of the public API too, and the
  // reverse. Same limit, same address, its own count.
  key: addressIn('comment'),
  message: 'Too many comments. Please wait a few minutes.'
})

/**
 * The unsubscribe link in reply notifications.
 *
 * Open to anyone, so limited; generous, because one reader may be clearing a
 * week of mail. The token's signature is what stops guessing.
 */
export const unsubscribeLimit = rateLimit({
  limit: 30,
  window: '10m',
  store,
  key: addressIn('unsubscribe'),
  message: 'Too many requests. Please try again shortly.'
})

/**
 * Asking for a password reset link, from one address.
 *
 * The per-address half only. The per-mailbox half runs inside the controller
 * on `emailSendLimiter`, because a limited request there must still get the
 * same 200 as every other — a 429 that only appears for addresses with an
 * account would answer the question the endpoint is built not to answer.
 * This one is safe as middleware: it refuses everyone from the address alike,
 * registered or not.
 */
export const passwordResetLimit = rateLimit({
  limit: 5,
  window: '15m',
  blockFor: '15m',
  store,
  key: addressIn('password-reset'),
  message: 'Too many reset requests. Please try again shortly.'
})

/**
 * Spending a reset or invitation link.
 *
 * The tokens are 32 random bytes, so this is not what stops guessing — the
 * entropy is. It stops one address hammering the password hash, which both
 * endpoints run on every attempt.
 */
export const tokenRedeemLimit = rateLimit({
  limit: 10,
  window: '15m',
  blockFor: '15m',
  store,
  key: addressIn('token-redeem'),
  message: 'Too many attempts. Please try again shortly.'
})

/**
 * Invitations sent by one account.
 *
 * Each one is an email to an address the sender chose, which is the shape of
 * a spam relay if a session is ever stolen. Keyed on the account, so it runs
 * after `auth`; generous enough to onboard a team in one sitting.
 */
export const invitationLimit = rateLimit({
  limit: 20,
  window: '1h',
  store,
  key: (req: Request) => `invite:${req.userId ?? ''}`,
  message: 'Too many invitations sent. Please try again later.'
})

/**
 * Writes made with an API token.
 *
 * Unlike `publicApiLimit` this keys on the token, which is safe here because
 * it runs *after* the token has been verified — `authOrToken` consumes from it
 * only once the hash matched a live token whose owner's account is usable, so
 * a fabricated token never reaches it and cannot mint itself a bucket. Per
 * token rather than per address because a write credential is the thing worth
 * containing: a leaked one, or a sync job stuck in a loop, should run out of
 * budget on its own without starving the CI box next to it.
 *
 * Reads through the same middleware are not counted; `/api/v1` is the place
 * for bulk reads, and it has its own limit.
 *
 * Sixty a minute is a bulk import of a few hundred posts in a handful of
 * minutes — slow enough to notice a runaway, fast enough for a real migration.
 */
export const tokenWriteLimiter = createLimiter({
  limit: 60,
  window: '1m',
  blockFor: '1m',
  store
})


/**
 * Site health actions that touch the outside world: the storage probe and
 * the test email. Admin-only already; this keeps a stuck button or a stolen
 * session from turning either into a loop. Keyed on the account.
 */
export const healthActionLimit = rateLimit({
  limit: 10,
  window: '15m',
  store,
  key: (req: Request) => `health:${req.userId ?? ''}`,
  message: 'Too many checks. Please try again in a few minutes.'
})
