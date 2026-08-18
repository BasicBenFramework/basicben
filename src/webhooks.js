/**
 * Outbound webhooks.
 *
 * A headless consumer's whole workflow is *content changed → rebuild*. Without
 * a notification it polls, which is wasteful when nothing changed and slow when
 * something did. This is the other half of the content API.
 *
 * ## No retry queue
 *
 * A failed delivery is logged and dropped. Retrying properly means a durable
 * queue — a table, a worker, a backoff schedule that survives a restart — and
 * this framework has none of those. A retry loop held in memory would lose
 * everything on the next deploy while looking like it guarantees delivery,
 * which is worse than being clear that it does not.
 *
 * So: at-most-once. A consumer that cannot miss an event should treat webhooks
 * as a latency optimisation and poll as the backstop. That is a real limitation
 * and it is documented rather than papered over.
 *
 * ## Signing
 *
 * Every request carries `X-BasicBen-Signature: sha256=<hex>`, an HMAC of the
 * exact bytes sent, keyed with `APP_KEY`. A receiver must compute the HMAC over
 * the raw body — a body parsed and re-serialised does not reproduce it, which
 * is why `bodyParser` grew a `skip` option.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** How long to wait on a receiver before giving up. */
const DEFAULT_TIMEOUT = 5000

/**
 * Sign a payload.
 *
 * @param {string} body - the exact bytes that will be sent
 * @param {string} secret
 * @returns {string} `sha256=<hex>`
 */
export function sign(body, secret) {
  return `sha256=${createHmac('sha256', String(secret)).update(body).digest('hex')}`
}

/**
 * Verify a signature against a raw body.
 *
 * Compared with `timingSafeEqual`, so the check does not leak how much of a
 * forged signature was correct. Lengths are compared first because
 * `timingSafeEqual` throws on a mismatch rather than returning false.
 *
 * @param {string} body - the raw request body, exactly as received
 * @param {string} signature - the X-BasicBen-Signature header
 * @param {string} secret
 * @returns {boolean}
 */
export function verify(body, signature, secret) {
  if (typeof signature !== 'string') return false

  const expected = Buffer.from(sign(body, secret))
  const actual = Buffer.from(signature)

  if (expected.length !== actual.length) return false

  return timingSafeEqual(expected, actual)
}

/**
 * Deliver one event to every configured URL.
 *
 * Deliveries run concurrently and independently: one slow or broken receiver
 * must not delay or cancel the others. Nothing here throws — a webhook failing
 * must never fail the request that triggered it, which is a content write the
 * user already considers done.
 *
 * @param {Object} options
 * @param {string[]} options.urls
 * @param {string} options.event - e.g. 'post.created'
 * @param {Object} options.data - merged into the payload
 * @param {string} options.secret
 * @param {number} [options.timeout]
 * @param {Function} [options.fetch] - injectable for tests
 * @returns {Promise<Array<{url: string, ok: boolean, status?: number, error?: string}>>}
 */
export async function deliver({
  urls = [],
  event,
  data = {},
  secret,
  timeout = DEFAULT_TIMEOUT,
  fetch: fetchImpl = globalThis.fetch
} = {}) {
  if (!Array.isArray(urls) || urls.length === 0) return []

  // Serialised once, so every receiver gets identical bytes and the signature
  // means the same thing to all of them.
  const body = JSON.stringify({ event, ...data, at: new Date().toISOString() })
  const signature = sign(body, secret)

  return Promise.all(
    urls.map(async (url) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-BasicBen-Event': event,
            'X-BasicBen-Signature': signature
          },
          body,
          signal: controller.signal
        })

        if (!res.ok) {
          console.error(`[webhooks] ${event} -> ${url} returned ${res.status}`)
        }

        return { url, ok: res.ok, status: res.status }
      } catch (err) {
        // An unreachable receiver, a DNS failure, or the timeout above. All of
        // them mean the same thing here: this event is gone.
        console.error(`[webhooks] ${event} -> ${url} failed: ${err.message}`)

        return { url, ok: false, error: err.message }
      } finally {
        clearTimeout(timer)
      }
    })
  )
}
