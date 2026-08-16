/**
 * Rate limits for the authentication endpoints.
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

import { rateLimit, createLimiter, DatabaseStore } from '@basicbenframework/core/rate-limit'
import { getDb } from '@basicbenframework/core/db'
import type { Request } from '../types'

const store = new DatabaseStore({ getDb })

// Set this when running behind a proxy that overwrites X-Forwarded-For.
// Leaving it off on a directly-exposed server is deliberate: the header is
// client-supplied, so trusting it would let anyone rotate their apparent
// address and bypass every limit here.
const trustProxy = process.env.TRUST_PROXY === 'true'

const address = (req: Request) => `ip:${(req as any).socket?.remoteAddress ?? ''}`
const emailKey = (req: Request) => {
  const email = (req.body as { email?: string })?.email
  return email ? `email:${String(email).toLowerCase()}` : null
}

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
  trustProxy,
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
  trustProxy,
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
  trustProxy,
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

export { address }
