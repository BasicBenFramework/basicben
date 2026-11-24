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
import { credentialHeaders } from '../helpers/access.ts'
import type { Request, Response } from '../types/index.ts'

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

    // A response that needed a credential is for whoever held it. Marking it
    // `public` let a shared cache or CDN hand it to the next caller with no
    // token at all; `private` keeps it in the requesting client's own cache.
    // Anonymous reads (public_api on) stay public and shareable.
    //
    // A reader's credential for restricted posts (the access policy names
    // its headers; the members feature's is X-Member-Token) counts too: with
    // one, a restricted body is in the response, and a shared cache that
    // stored it would hand it to the next anonymous reader. The header's mere
    // presence is enough — valid or not — so the rule cannot depend on a
    // lookup, and `Vary` names it so a cache keyed on headers never crosses
    // the two.
    const readerHeaders = credentialHeaders()
    const credentialed = Boolean(req.headers.authorization || readerHeaders.some((name) => req.headers[name.toLowerCase()]))
    res.setHeader('Vary', ['Authorization', ...readerHeaders].join(', '))

    if (
      conditional(req, res, {
        etag: strongEtag(body),
        cacheControl: `${credentialed ? 'private' : 'public'}, max-age=${MAX_AGE_SECONDS}`
      })
    ) {
      return
    }

    send(data, status)
  }

  next()
}
