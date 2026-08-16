/**
 * Rate limiting.
 *
 * Three features grew their own answer to this question before it existed —
 * an email-resend cooldown enforced by the token table, and a per-user lockout
 * on each second factor. Those solved their own case correctly but left the
 * obvious hole open: password guessing on the login endpoint was unthrottled.
 *
 * ## Sliding window, not fixed
 *
 * A fixed window lets a caller spend the whole allowance at the end of one
 * window and again at the start of the next, so a "5 per minute" limit permits
 * 10 in two seconds. This keeps the timestamps of recent hits and counts the
 * ones still inside the window, which costs an array per key and removes the
 * boundary burst entirely. Auth limits are small, so the array stays small.
 *
 * ## Two stores
 *
 * Memory is the default and is per-process: fine for smoothing traffic, wrong
 * for a lockout, because a restart clears it and a second instance does not
 * see it. The database store is the one to use when the limit is a security
 * control rather than a courtesy.
 */

import { MemoryStore } from './rate-limit-stores.js'

export { MemoryStore, DatabaseStore } from './rate-limit-stores.js'

/**
 * Parse a duration.
 *
 * @param {number|string} value - ms, or '30s' / '15m' / '2h' / '1d'
 * @returns {number} milliseconds
 */
export function parseDuration(value) {
  if (typeof value === 'number') return value

  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/)
  if (!match) throw new Error(`Cannot parse duration "${value}"`)

  const amount = Number(match[1])
  const unit = match[2] || 'ms'

  const multipliers = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return amount * multipliers[unit]
}

/**
 * Create a limiter.
 *
 * @param {Object} options
 * @param {number} options.limit - hits allowed per window
 * @param {number|string} options.window - the window
 * @param {Object} [options.store]
 * @param {number|string} [options.blockFor] - after the limit, refuse for this
 *   long regardless of the window. Turns a throttle into a lockout.
 * @returns {{ check: Function, consume: Function, reset: Function, peek: Function }}
 */
export function createLimiter({ limit, window, store, blockFor } = {}) {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error('createLimiter requires a positive limit')
  }

  const windowMs = parseDuration(window ?? '1m')
  const blockMs = blockFor === undefined ? null : parseDuration(blockFor)
  const backing = store || new MemoryStore()

  return {
    /**
     * Record a hit and report whether it is allowed.
     *
     * @param {string} key
     * @returns {Promise<{ allowed: boolean, remaining: number, retryAfter: number, resetAt: number, limit: number }>}
     */
    async consume(key) {
      const now = Date.now()
      const state = await backing.hit(String(key), { windowMs, now, limit, blockMs })

      return describe(state, limit, now)
    },

    /**
     * Report the current state without recording a hit.
     *
     * Useful when a request should only count against the limit if it fails —
     * a correct password should not consume the guess allowance.
     *
     * @param {string} key
     */
    async peek(key) {
      const now = Date.now()
      const state = await backing.peek(String(key), { windowMs, now, limit })

      return describe(state, limit, now)
    },

    /**
     * Clear a key. Call this on success so a legitimate user who mistyped a
     * password twice is not still part-way to a lockout.
     *
     * @param {string} key
     */
    async reset(key) {
      await backing.reset(String(key))
    },

    /** Exposed so a caller can share or inspect the store. */
    store: backing
  }
}

function describe(state, limit, now) {
  const remaining = Math.max(0, limit - state.count)
  const allowed = !state.blocked && state.count <= limit

  const resetAt = state.blockedUntil || state.resetAt || now

  return {
    allowed,
    limit,
    remaining: allowed ? remaining : 0,
    resetAt,
    retryAfter: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000))
  }
}

/**
 * Rate-limiting middleware.
 *
 * @param {Object} options - everything createLimiter takes, plus:
 * @param {(req) => string} [options.key] - defaults to the client address
 * @param {boolean} [options.trustProxy] - honour X-Forwarded-For
 * @param {(req, res, info) => void} [options.onLimited]
 * @param {boolean} [options.headers] - emit RateLimit-* headers (default true)
 * @returns {Function} middleware
 */
export function rateLimit(options = {}) {
  const limiter = options.limiter || createLimiter(options)
  const keyFor = options.key || ((req) => clientAddress(req, options.trustProxy))
  const emitHeaders = options.headers !== false

  const middleware = async (req, res, next) => {
    const key = keyFor(req)

    // A limiter that cannot identify the caller would apply one shared bucket to
    // everyone, which is worse than not limiting: one abuser locks out the site.
    if (!key) return next()

    const result = await limiter.consume(key)

    if (emitHeaders) {
      res.setHeader('RateLimit-Limit', String(result.limit))
      res.setHeader('RateLimit-Remaining', String(result.remaining))
      res.setHeader('RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)))
    }

    if (result.allowed) return next()

    res.setHeader('Retry-After', String(result.retryAfter))

    if (options.onLimited) {
      return options.onLimited(req, res, result)
    }

    return res.json(
      { error: options.message || 'Too many requests. Please try again shortly.', retryAfter: result.retryAfter },
      429
    )
  }

  // The limiter and the key function are attached so a handler can clear a key
  // once the request turns out to be legitimate — a correct password should not
  // leave the caller part-way to a lockout.
  middleware.limiter = limiter
  middleware.key = keyFor

  return middleware
}

/**
 * Work out who is calling.
 *
 * **X-Forwarded-For is only consulted when trustProxy is set**, and that is not
 * a default worth having: the header is client-supplied, so honouring it on a
 * directly-exposed server lets anyone rotate their apparent address and bypass
 * every limit here. Behind a proxy that overwrites the header, set it.
 *
 * @param {Object} req
 * @param {boolean} [trustProxy]
 * @returns {string}
 */
export function clientAddress(req, trustProxy = false) {
  if (trustProxy) {
    const forwarded = req.headers?.['x-forwarded-for']
    if (forwarded) {
      // The left-most entry is the original client; the rest are proxies.
      const first = String(forwarded).split(',')[0]?.trim()
      if (first) return first
    }

    const real = req.headers?.['x-real-ip']
    if (real) return String(real).trim()
  }

  return req.socket?.remoteAddress || req.connection?.remoteAddress || ''
}
