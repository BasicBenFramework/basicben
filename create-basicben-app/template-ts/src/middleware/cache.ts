/**
 * Conditional GETs for JSON responses.
 *
 * A headless consumer is usually a build step that fetches the same content
 * repeatedly — a static site generator rebuilding, a cron re-syncing. Sending
 * an unchanged 200KB payload to a client that already has it is the bulk of
 * what such an API does if nobody makes it cacheable.
 *
 * The ETag is a hash of the body, computed after the handler has produced it,
 * so it costs one hash per response and needs no bookkeeping about which tables
 * a route touched. That is the trade: it saves bandwidth and client parsing,
 * not the database work that produced the body.
 */

import { strongEtag, conditional } from '@basicbenframework/core/etag'
import type { Request, Response } from '../types'

type Next = () => void

/** How long a consumer may reuse a response without revalidating. */
const MAX_AGE_SECONDS = 60

export const cacheable = (req: Request, res: Response, next: Next) => {
  const send = res.json.bind(res)

  res.json = (data: unknown, status?: number) => {
    // Only successful reads are cacheable. A 404 carrying an ETag would have a
    // client revalidating a resource that does not exist, and an error body is
    // not a representation of anything worth storing.
    if (status !== undefined && status >= 300) {
      return send(data, status)
    }

    const body = JSON.stringify(data)

    if (
      conditional(req, res, {
        etag: strongEtag(body),
        cacheControl: `public, max-age=${MAX_AGE_SECONDS}`
      })
    ) {
      return
    }

    send(data, status)
  }

  next()
}
