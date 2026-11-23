/**
 * Where content lives on the public site, and which links are safe to emit.
 *
 * The CMS is headless, so it does not own these URLs — but the feeds and the
 * sitemap already hand out `/blog/:slug`, `/:slug` and `/category/:slug`, and
 * navigation menus and automatic redirects have to agree with them or a menu
 * link and the redirect for the same post would point at different places.
 * They are named once, here.
 *
 * Content types add one more shape — `${route_base}/${slug}` — through
 * `entryPath`, which hands a plain post straight to `postPath`.
 *
 * Nothing in this file touches the database, so tests import it directly.
 */

/** A post's public path. Posts written before slugs existed answer to their id. */
export function postPath(slug: string | null | undefined, id?: number): string {
  return `/blog/${slug || id}`
}

/**
 * Where the built-in `post` type lives. Fixed: every feed, sitemap and
 * automatic redirect already written says `/blog`, so the built-in type's
 * route base is not editable (see migration 038).
 */
export const POST_ROUTE_BASE = '/blog'

/**
 * A post's public path, for any content type.
 *
 * `routeBase` is the type's `route_base` (`/recipes`). The built-in type — or
 * a missing base, which is what a row written before content types existed
 * effectively has — goes through `postPath`, so a plain post's path is
 * computed exactly as it always was.
 */
export function entryPath(routeBase: string | null | undefined, slug: string | null | undefined, id?: number): string {
  if (!routeBase || routeBase === POST_ROUTE_BASE) return postPath(slug, id)
  return `${routeBase}/${slug || id}`
}

/** A tag archive's public path. */
export function tagPath(slug: string): string {
  return `/tag/${slug}`
}

/** An author archive's public path. */
export function authorPath(slug: string): string {
  return `/author/${slug}`
}

/** A custom taxonomy term's archive path on the reference theme. */
export function termPath(taxonomy: string, slug: string): string {
  return `/taxonomy/${taxonomy}/${slug}`
}

/**
 * First path segments a content type may not claim as its route base.
 *
 * Each is already a server route, an admin or SPA route, a theme archive, or a
 * static directory. A type at `/admin` would put recipes where the admin is;
 * one at `/api` would shadow nothing (the API is matched first) but every link
 * to it would be a JSON error. Checked case-insensitively.
 */
export const RESERVED_ROUTE_SEGMENTS = [
  'admin', 'api', 'assets', 'uploads', 'feed', 'feed.xml', 'feed.json', 'sitemap.xml',
  'robots.txt', 'oembed', 'blog', 'category', 'tag', 'author', 'page', 'taxonomy',
  'login', 'register', 'logout', 'forgot-password', 'reset-password', 'invite',
  'profile', 'posts', 'docs', 'favicon.svg', 'favicon.ico', 'index.html'
]

/**
 * Normalise a route base: one leading slash, lowercase, a single segment of
 * letters, digits and hyphens. Null when it is not one, or is reserved.
 *
 * One segment only, because the theme matches `/:base/:slug` — a base of
 * `/a/b` would need a route shape nothing serves.
 */
export function normalizeRouteBase(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const segment = value.trim().replace(/^\/+|\/+$/g, '').toLowerCase()

  if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(segment)) return null
  if (RESERVED_ROUTE_SEGMENTS.includes(segment)) return null

  return `/${segment}`
}

/** A page's public path. Pages always have a slug: the column is NOT NULL. */
export function pagePath(slug: string): string {
  return `/${slug}`
}

/** A category archive's public path. */
export function categoryPath(slug: string): string {
  return `/category/${slug}`
}

/** Longest link or path we store. Matches the practical limit browsers keep. */
export const MAX_URL_LENGTH = 2048

// Whitespace and control characters have no business in a stored link. A
// newline in particular is how header injection and "looks like one URL, is
// two" tricks start, and a tab or NUL inside `java\tscript:` is how browsers
// used to be talked into running a scheme the filter thought it had refused.
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f\\]/

/**
 * A root-relative path: `/about`, `/blog/hello?x=1#top`.
 *
 * `//host/...` is refused because it is not relative at all — it is a
 * protocol-relative URL to someone else's host, and it is the classic way an
 * "only local paths" filter gets turned into an open redirect.
 */
export function isRelativePath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !UNSAFE_CHARS.test(value)
}

/** An absolute http(s) URL with a host. */
export function isHttpUrl(value: string): boolean {
  if (UNSAFE_CHARS.test(value)) return false

  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  } catch {
    return false
  }
}

/**
 * Is this safe to put in a navigation menu?
 *
 * An allowlist, not a blocklist of `javascript:`: http(s), a root-relative
 * path, or `mailto:`. Every other scheme — `javascript:`, `data:`, `vbscript:`,
 * whatever a browser invents next — is refused because a front end renders
 * these straight into `href`, and a menu link that runs script is stored XSS
 * on every page of the site.
 */
export function isSafeLinkUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const url = value.trim()

  if (url === '' || url.length > MAX_URL_LENGTH) return false
  if (isRelativePath(url) || isHttpUrl(url)) return true

  // mailto: with an address after it. Checked case-insensitively, as browsers
  // treat the scheme.
  return /^mailto:[^\s]+$/i.test(url) && !UNSAFE_CHARS.test(url)
}

/**
 * The form a redirect's `from_path` is stored and matched in.
 *
 * Path only — no query, no fragment — with one leading slash and no trailing
 * one (except the root). A redirect from `/old/` and a request for `/old` are
 * the same thing to a reader, so they have to be the same row to us; otherwise
 * whichever form the front end happened to normalise to would miss.
 *
 * Returns null for anything that is not a local path.
 */
export function normalizeRedirectSource(value: unknown): string | null {
  if (typeof value !== 'string') return null

  let path = value.trim()

  // Accept a full URL pasted from the address bar and keep only its path: the
  // front end applies the redirect on its own host, whatever that host is.
  if (isHttpUrl(path)) path = new URL(path).pathname

  // A lookup may arrive with its query string attached; redirects match the
  // path alone.
  path = path.split(/[?#]/)[0]

  if (!path.startsWith('/')) path = `/${path}`
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/'

  if (!isRelativePath(path) || path.length > MAX_URL_LENGTH) return null

  return path
}

/**
 * The form a redirect's `to_path` is stored in.
 *
 * Either a local path (query and fragment allowed — "/search?q=x" is a fine
 * destination) or an absolute http(s) URL, for content that moved to another
 * site. Never another scheme: a redirect to `javascript:` is the same stored
 * XSS as a menu link to it.
 */
export function normalizeRedirectTarget(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const target = value.trim()

  if (target === '' || target.length > MAX_URL_LENGTH) return null
  if (isHttpUrl(target)) return target
  if (!isRelativePath(target)) return null

  // Trailing slash trimmed on the path part only, so `/a/` and `/a` do not
  // become two different destinations of the same move.
  const [path, ...rest] = target.split(/(?=[?#])/)
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') || '/' : path

  return trimmed + rest.join('')
}

/**
 * The path part of a redirect target, for comparing it with a `from_path`.
 *
 * Null for an external URL, which can never be the start of another redirect
 * here and so can never close a loop.
 */
export function targetPath(target: string): string | null {
  return isHttpUrl(target) ? null : normalizeRedirectSource(target)
}
