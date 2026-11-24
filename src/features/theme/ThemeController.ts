import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { strongEtag, conditional } from '@basicbenframework/core/etag'
import { PublicContent } from '../../models/PublicContent.ts'
import { Settings } from '../../models/Settings.ts'
import { ContentType, type ContentTypeRecord } from '../../models/ContentType.ts'
import { Taxonomy } from '../../models/Taxonomy.ts'
import { Menu } from '../../models/Menu.ts'
import { Redirect } from '../../models/Redirect.ts'
import { normalizeRedirectSource, RESERVED_ROUTE_SEGMENTS, POST_ROUTE_BASE } from '../../helpers/content-paths.ts'
import { renderListing, renderEntry, renderPage, renderNotFound, pathOf, listingPath, type ThemeContext } from './templates.ts'
import type { Request, Response } from '../../types/index.ts'

/**
 * The reference public site, rendered on the server.
 *
 * Off unless `PUBLIC_THEME=ssr` is set or the `public_theme` setting is `ssr`
 * (`PUBLIC_THEME=off` forces it off whatever the setting says). While it is
 * off, every route here answers exactly as the SPA fallback would, so
 * registering the routes changes nothing for a site that has not opted in.
 *
 * Every read goes through `PublicContent` — the functions behind
 * `/api/v1` — so what a visitor may see is decided in one place for the API
 * and the theme alike.
 */

/** How long a shared cache may reuse a page: the content API's own figure. */
const MAX_AGE_SECONDS = 60

/** How long a decision about whether the theme is on is reused, per instance. */
const ENABLED_TTL_MS = 30_000
let enabledCache: { value: boolean; at: number } | null = null

export async function themeEnabled(): Promise<boolean> {
  if (process.env.DISABLE_PUBLIC_SITE === 'true') return false
  if (process.env.PUBLIC_THEME === 'ssr') return true
  if (process.env.PUBLIC_THEME === 'off') return false

  if (enabledCache && Date.now() - enabledCache.at < ENABLED_TTL_MS) return enabledCache.value

  let value = false
  try {
    value = (await Settings.get('public_theme')) === 'ssr'
  } catch {
    value = false
  }
  enabledCache = { value, at: Date.now() }
  return value
}

/** For tests and for the settings screen: forget the cached decision. */
export function resetThemeCache(): void {
  enabledCache = null
}

/**
 * First segments the SPA owns. A request for one of these is never the
 * theme's, even with the theme on: `/login`, `/admin/...` and friends go to
 * the app shell exactly as before.
 */
const SPA_SEGMENTS = new Set([
  'admin', 'login', 'register', 'logout', 'forgot-password', 'reset-password', 'invite',
  'profile', 'posts', 'docs', 'feed'
])

/** The SPA's index.html, as the framework's own fallback would serve it. */
function sendAppShell(req: Request, res: Response): void {
  // The framework's fallback answers these with a JSON 404 rather than the
  // shell — an API path or a missing asset must not receive HTML — so these
  // routes, which can match them, must too.
  const path = (req as unknown as { path?: string }).path || '/'
  if (path.startsWith('/api/') || /\.(?!html?$)[a-z0-9]+$/i.test(path)) return res.json({ error: 'Not Found' }, 404)

  const dir = process.env.NODE_ENV === 'production' ? 'dist/client' : 'public'
  const index = join(resolve(process.cwd(), dir), 'index.html')
  const raw = res as unknown as { statusCode: number; end: (body?: string) => void }

  try {
    if (!statSync(index).isFile()) throw new Error('no shell')
    raw.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    // Same rule as the framework: the shell names hashed assets, so it must
    // never be served stale.
    res.setHeader('Cache-Control', 'no-cache')
    raw.end((req as unknown as { method?: string }).method === 'HEAD' ? undefined : readFileSync(index, 'utf-8'))
  } catch {
    res.json({ error: 'Not Found' }, 404)
  }
}

/** Send a rendered page with an ETag, as `cacheable` does for JSON. */
function sendHtml(req: Request, res: Response, body: string, status = 200): void {
  const raw = res as unknown as { statusCode: number; end: (body?: string) => void }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Anonymous and identical for every visitor, so a CDN may share it. A 404
  // is cached briefly too — a typo'd URL hammered by a crawler should not
  // reach the database each time — but without an ETag, as cache.ts does.
  res.setHeader('Vary', 'Accept-Encoding')

  if (status === 200) {
    if (conditional(req, res, { etag: strongEtag(body), cacheControl: `public, max-age=${MAX_AGE_SECONDS}` })) return
  } else {
    res.setHeader('Cache-Control', `public, max-age=${MAX_AGE_SECONDS}`)
  }

  raw.statusCode = status
  raw.end((req as unknown as { method?: string }).method === 'HEAD' ? undefined : body)
}

async function context(req: Request): Promise<ThemeContext> {
  const [site, types, menus] = await Promise.all([
    Settings.siteInfo(),
    ContentType.all(),
    Menu.publicNavigation('primary').catch(() => ({} as Record<string, never[]>))
  ])

  return {
    site,
    path: (req as unknown as { path?: string }).path || '/',
    types,
    menu: ((menus as Record<string, unknown>).primary as ThemeContext['menu']) ?? []
  }
}

function pageNumber(req: Request): number {
  const fromPath = Number(req.params.page)
  const fromQuery = Number(req.query.page)
  const page = Number.isInteger(fromPath) && fromPath > 0 ? fromPath : fromQuery
  return Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1
}

/**
 * Nothing matched: apply the redirects table, then render the 404.
 *
 * The CMS has always kept redirects for a front end to apply; with the theme
 * on, this is that front end. Checked only on a miss, so a live post can never
 * be shadowed by a stale rule (Redirect.releasePath also guarantees that).
 */
async function notFound(req: Request, res: Response, ctx?: ThemeContext): Promise<void> {
  const path = normalizeRedirectSource((req as unknown as { path?: string }).path || '/')
  if (path) {
    const match = await Redirect.lookup(path)
    if (match) {
      await Redirect.hit(match.id)
      res.setHeader('Cache-Control', `public, max-age=${MAX_AGE_SECONDS}`)
      return res.redirect(match.to_path, Number(match.status) === 302 ? 302 : 301)
    }
  }

  sendHtml(req, res, renderNotFound(ctx ?? (await context(req))), 404)
}

async function listing(
  req: Request,
  res: Response,
  options: {
    title: string
    basePath: string
    intro?: string | null
    heading?: boolean
    type?: string
    category?: string
    tag?: string
    author?: string
    taxonomy?: Record<string, string>
  },
  ctx: ThemeContext,
  extra: { author?: Awaited<ReturnType<typeof PublicContent.author>> } = {}
): Promise<void> {
  const page = pageNumber(req)
  const perPage = await Settings.getPostsPerPage()

  const { posts, total } = await PublicContent.posts({
    perPage,
    offset: (page - 1) * perPage,
    type: options.type ?? 'post',
    category: options.category,
    tag: options.tag,
    author: options.author,
    taxonomy: options.taxonomy
  })

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  // Past the last page is a 404, not an empty listing: a crawler following
  // `?page=` forever should be told to stop.
  if (page > totalPages) return notFound(req, res, ctx)

  sendHtml(req, res, renderListing(ctx, { ...options, posts, page, totalPages, author: extra.author }))
}

/** Render one entry, or 404 if it is not live — or not of this type. */
async function entry(req: Request, res: Response, type: ContentTypeRecord, slug: string, ctx: ThemeContext): Promise<void> {
  const post = await PublicContent.post(slug, 'html', { type: type.key })
  if (!post) return notFound(req, res, ctx)

  // Reached by id, or by a path that is not its own: send it to its address
  // so each entry has exactly one URL.
  const own = pathOf(ctx, post)
  if (own !== (req as unknown as { path?: string }).path) return res.redirect(own, 301)

  sendHtml(req, res, renderEntry(ctx, post))
}

/**
 * Gate every theme handler: off means the SPA, and an SPA path means the SPA
 * whether the theme is on or not.
 */
function themed(handler: (req: Request, res: Response, ctx: ThemeContext) => Promise<void>) {
  return async (req: Request, res: Response) => {
    const first = String(((req as unknown as { path?: string }).path || '/').split('/')[1] || '').toLowerCase()
    if (!(await themeEnabled()) || SPA_SEGMENTS.has(first)) return sendAppShell(req, res)

    await handler(req, res, await context(req))
  }
}

export const ThemeController = {
  home: themed(async (req, res, ctx) => {
    // One address per page: `/?page=2` is `/page/2`, the one the pager links.
    const page = pageNumber(req)
    if (page > 1) return res.redirect(listingPath('/', page), 301)
    await listing(req, res, { title: ctx.site.name, intro: ctx.site.description, basePath: '/', heading: false }, ctx)
  }),

  /** `/blog/:slug` — a blog post. */
  post: themed(async (req, res, ctx) => {
    const type = ctx.types.find((candidate) => candidate.key === 'post')!
    await entry(req, res, type, req.params.slug, ctx)
  }),

  /** `/:segment` — a type's archive if a type lives there, otherwise a page. */
  single: themed(async (req, res, ctx) => {
    const segment = req.params.slug

    if (`/${segment}` === POST_ROUTE_BASE) return res.redirect('/', 301)

    const type = ctx.types.find((candidate) => !candidate.builtin && candidate.public && candidate.route_base === `/${segment}`)
    if (type) {
      return listing(req, res, { title: type.plural_label, intro: type.description, basePath: type.route_base, type: type.key }, ctx)
    }

    const page = await PublicContent.page(segment)
    if (!page) return notFound(req, res, ctx)
    if (page.slug !== segment) return res.redirect(`/${page.slug}`, 301)

    sendHtml(req, res, renderPage(ctx, page))
  }),

  /** `/:base/:slug` — an entry of a custom type. Anything else two segments deep is the SPA's or a 404. */
  typed: themed(async (req, res, ctx) => {
    const type = ctx.types.find((candidate) => !candidate.builtin && candidate.public && candidate.route_base === `/${req.params.base}`)
    if (!type) {
      return RESERVED_ROUTE_SEGMENTS.includes(req.params.base) ? sendAppShell(req, res) : notFound(req, res, ctx)
    }
    await entry(req, res, type, req.params.slug, ctx)
  }),

  /** `/page/:page` — the home page, paginated the WordPress way. */
  homePage: themed(async (req, res, ctx) => {
    if (pageNumber(req) <= 1) return res.redirect('/', 301)
    await listing(req, res, { title: ctx.site.name, intro: ctx.site.description, basePath: '/', heading: false }, ctx)
  }),

  category: themed(async (req, res, ctx) => {
    const category = (await PublicContent.categories()).find((c) => c.slug === req.params.slug)
    if (!category) return notFound(req, res, ctx)
    await listing(req, res, { title: category.name, intro: category.description, basePath: `/category/${category.slug}`, category: category.slug, type: 'any' }, ctx)
  }),

  tag: themed(async (req, res, ctx) => {
    const tag = (await PublicContent.tags()).find((t) => t.slug === req.params.slug)
    if (!tag) return notFound(req, res, ctx)
    await listing(req, res, { title: `Tagged “${tag.name}”`, basePath: `/tag/${tag.slug}`, tag: tag.slug, type: 'any' }, ctx)
  }),

  author: themed(async (req, res, ctx) => {
    const author = await PublicContent.author(req.params.slug)
    if (!author || !author.slug) return notFound(req, res, ctx)
    await listing(req, res, { title: author.name, intro: author.bio, basePath: `/author/${author.slug}`, author: author.slug, type: 'any' }, ctx, { author })
  }),

  /** `/taxonomy/:key/:slug` — a custom taxonomy term's archive. */
  term: themed(async (req, res, ctx) => {
    const taxonomy = await Taxonomy.findByKey(req.params.key)
    if (!taxonomy || !taxonomy.public) return notFound(req, res, ctx)
    const term = await Taxonomy.findTermBySlug(taxonomy.id, req.params.slug)
    if (!term) return notFound(req, res, ctx)
    await listing(req, res, {
      title: `${taxonomy.singular_label}: ${term.name}`,
      intro: term.description,
      basePath: `/taxonomy/${taxonomy.key}/${term.slug}`,
      taxonomy: { [taxonomy.key]: term.slug },
      type: 'any'
    }, ctx)
  })
}
