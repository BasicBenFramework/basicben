/**
 * The members feature's rate limits. Same store and address keying as core's
 * (middleware/rate-limits.ts), each on its own bucket.
 */

import { rateLimit } from '@basicbenframework/core/rate-limit'
import { store, addressIn } from '../../middleware/rate-limits.ts'
import type { Request } from '../../types/index.ts'

/**
 * Asking for a member magic link, from one address.
 *
 * The per-address half, as middleware: it refuses everyone from the address
 * alike, so its 429 says nothing about whether any address is a member. The
 * per-mailbox half runs silently inside MemberController on
 * `emailSendLimiter`, for the reason `passwordResetLimit` gives.
 */
export const memberMagicLinkLimit = rateLimit({
  limit: 5,
  window: '15m',
  blockFor: '15m',
  store,
  key: addressIn('member-magic-link'),
  message: 'Too many sign-in requests. Please try again shortly.'
})

/**
 * Spending a magic link. The tokens are 32 random bytes, so entropy stops
 * guessing; this stops one address hammering the lookup.
 */
export const memberVerifyLimit = rateLimit({
  limit: 20,
  window: '15m',
  blockFor: '15m',
  store,
  key: addressIn('member-verify'),
  message: 'Too many attempts. Please try again shortly.'
})

/** A member changing their own profile. Keyed on the member, so it runs after `requireMember`. */
export const memberAccountLimit = rateLimit({
  limit: 30,
  window: '15m',
  store,
  key: (req: Request) => (req.member ? `member:${req.member.id}` : null),
  message: 'Too many changes. Please try again shortly.'
})

/** The newsletter unsubscribe link. Its own bucket, not the comment one. */
export const memberUnsubscribeLimit = rateLimit({
  limit: 30,
  window: '10m',
  store,
  key: addressIn('member-unsubscribe'),
  message: 'Too many requests. Please try again shortly.'
})
