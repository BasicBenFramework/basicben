/**
 * The public site's origin, for links a feed, sitemap or robots.txt hands out.
 *
 * From configuration, never from the request. The Host header is whatever the
 * client sent, and these responses are cached — one request with a forged Host
 * would poison every reader's feed with links to somewhere else.
 *
 * SITE_URL is the public site when it is separate from this app (a headless
 * front end); APP_URL otherwise. The request is consulted only outside
 * production, so a local checkout works without either.
 */
export function siteUrl(req?: { headers?: Record<string, unknown> }): string {
  const configured = process.env.SITE_URL || process.env.APP_URL
  if (configured) return configured.replace(/\/+$/, '')

  if (process.env.NODE_ENV !== 'production') {
    const host = req?.headers?.host
    if (typeof host === 'string' && /^[a-z0-9.\-:\[\]]+$/i.test(host)) return `http://${host}`
    return 'http://localhost:3000'
  }

  return ''
}
