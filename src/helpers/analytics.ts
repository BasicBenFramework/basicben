/**
 * The pure half of page-view analytics: what counts as a page, a referrer, a
 * bot and an opt-out, and how a visitor becomes an unlinkable hash.
 *
 * The privacy model is in docs/analytics.md and migration 036. Everything
 * here is a function of its arguments — no database, no environment — so the
 * rules a privacy review cares about are tested directly.
 */

import { createHash } from 'node:crypto'

/** Longest path kept. Anything longer is almost certainly not a page. */
export const MAX_PATH_LENGTH = 300

/**
 * The page a hit is for, as a stable key: a path with a leading slash, no
 * query string, no fragment, no trailing slash, no doubled slashes.
 *
 * The query is dropped on purpose rather than for tidiness: it is where
 * tracking parameters, search terms, email addresses in a "confirm
 * subscription" link and password-reset tokens live, and none of that belongs
 * in a table that is kept indefinitely.
 *
 * A full http(s) URL is accepted and reduced to its path, because
 * `location.href` is the obvious thing for a front end to send. Anything else —
 * another scheme, a protocol-relative `//host`, whitespace or control
 * characters — is refused, since it can only be a mistake or garbage.
 */
export function normalizeAnalyticsPath(input: unknown): string | null {
  if (typeof input !== 'string') return null

  let value = input.trim()
  if (value === '' || value.length > 2048) return null

  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname
    } catch {
      return null
    }
  }

  if (!value.startsWith('/') || value.startsWith('//')) return null

  value = value.replace(/[?#].*$/s, '')

  // Control characters and whitespace: never part of a real path, and a way to
  // make one "page" look like many.
  if (/[\u0000- \u007f]/.test(value)) return null

  value = value.replace(/\/{2,}/g, '/')
  if (value.length > 1) value = value.replace(/\/+$/, '')

  if (value.length > MAX_PATH_LENGTH) return null

  return value || '/'
}

/**
 * The referring site as a bare host name (`news.ycombinator.com`), or null.
 *
 * Only the domain is kept, never the URL: a full referrer can carry a search
 * query, a session id or a link to someone's private document. A leading
 * `www.` is dropped so one site does not appear twice. The site's own hosts
 * are not referrers — moving between its own pages is not traffic arriving.
 */
export function referrerDomain(input: unknown, ownHosts: string[] = []): string | null {
  if (typeof input !== 'string' || input === '' || input.length > 2048) return null

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return null

  const own = new Set(ownHosts.filter(Boolean).map((h) => h.toLowerCase().replace(/^www\./, '')))
  if (own.has(host)) return null

  return host
}

/** The host of a URL, or null — for building the `ownHosts` list. */
export function hostOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Crawlers, monitors, link unfurlers and HTTP libraries.
 *
 * A heuristic, like every bot filter, and tuned to fail towards not counting:
 * an empty user agent is a bot, because no browser sends one. A determined
 * fake will get through — the rate limit is what bounds that.
 */
const BOT_UA = new RegExp(
  [
    'bot\\b', 'bot/', 'crawl', 'spider', 'slurp', 'mediapartners', 'facebookexternalhit', 'embedly',
    'preview', 'headless', 'lighthouse', 'pagespeed', 'phantomjs', 'puppeteer', 'playwright', 'selenium',
    'curl/', 'wget/', 'python-requests', 'python-urllib', 'aiohttp', 'httpx', 'go-http-client',
    'java/', 'okhttp', 'axios/', 'node-fetch', 'undici', 'libwww', 'httpclient', 'scrapy',
    'uptime', 'pingdom', 'monitor', 'statuscake', 'feedfetcher', 'feedly', 'validator', 'archive.org'
  ].join('|'),
  'i'
)

export function isBot(userAgent: unknown): boolean {
  if (typeof userAgent !== 'string' || userAgent.trim() === '') return true
  return BOT_UA.test(userAgent)
}

/**
 * Whether the browser has asked not to be tracked.
 *
 * Do Not Track is deprecated in browsers but still sent by people who turned
 * it on; Global Privacy Control (`Sec-GPC: 1`) is its successor with legal
 * weight in some jurisdictions. Either is honoured by not counting at all —
 * the counts are anonymous, but "not tracked" should not need a lawyer to
 * interpret.
 */
export function optedOut(headers: Record<string, unknown>): boolean {
  return String(headers['dnt'] ?? '').trim() === '1' || String(headers['sec-gpc'] ?? '').trim() === '1'
}

/** A date's UTC day as `YYYY-MM-DD`, the key every analytics table uses. */
export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

/** The UTC day `n` days before `date`. */
export function daysBefore(date: Date, n: number): string {
  return utcDay(new Date(date.getTime() - n * 86_400_000))
}

/**
 * One visitor, for one day, as an opaque string.
 *
 * `scope` is empty for "this visitor, anywhere on the site" and the path for
 * "this visitor, on this page". Hashing the path in, rather than storing it
 * beside the hash, is what keeps the rows of one visitor from being grouped
 * into a browsing trail: two pages by the same person are two unrelated
 * strings. Truncated to 128 bits — collisions at a blog's scale are not a
 * concern, and a shorter value is less of an identifier.
 */
export function visitorHash(salt: string, address: string, userAgent: string, scope = ''): string {
  return createHash('sha256')
    .update(salt).update('\0')
    .update(address).update('\0')
    .update(userAgent).update('\0')
    .update(scope)
    .digest('hex')
    .slice(0, 32)
}

/**
 * The body of a hit, whatever shape it arrived in.
 *
 * `navigator.sendBeacon` with a string body sends `text/plain`, which is what
 * makes it a "simple" request a browser will send cross-origin without a
 * preflight — and the body parser leaves text/plain as a raw string. So both a
 * parsed object and a JSON string are accepted.
 */
export function parseHitBody(body: unknown): { path?: unknown; referrer?: unknown } {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}

/** A day-by-day series, with days that had no rows filled in as zero. */
export function fillSeries(
  rows: Array<{ day: string; views: number; visitors: number }>,
  days: number,
  now: Date = new Date()
): Array<{ day: string; views: number; visitors: number }> {
  const byDay = new Map(rows.map((row) => [row.day, row]))
  const out = []

  for (let i = days - 1; i >= 0; i--) {
    const day = daysBefore(now, i)
    const row = byDay.get(day)
    out.push({ day, views: Number(row?.views ?? 0), visitors: Number(row?.visitors ?? 0) })
  }

  return out
}
