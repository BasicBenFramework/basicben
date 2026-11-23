import { strongEtag, conditional } from '@basicbenframework/core/etag'
import { PublicContent } from '../models/PublicContent'
import { Settings } from '../models/Settings'
import { ContentType } from '../models/ContentType'
import { siteUrl } from '../helpers/site'
import { POST_ROUTE_BASE } from '../helpers/content-paths'
import { resolveOEmbed, type OEmbedTarget } from '../theme/oembed'
import type { Request, Response } from '../types'

/**
 * `GET /oembed?url=…&format=json` — the oEmbed provider (oembed.com).
 *
 * Paste a link to a post into WordPress, Ghost, Slack or Discord and this is
 * what they ask for: a title, an author, a thumbnail and, for posts, a small
 * HTML card to embed. Only URLs on this site are answered — anything else is a
 * 404, so the endpoint cannot be used to make this server describe, or fetch,
 * somebody else's pages. Nothing is fetched at all: the URL is parsed, its
 * path matched against the site's own routes, and the entry read through
 * `PublicContent` like every other public read.
 *
 * The rich card is a `<blockquote>` with a link rather than an `<iframe>`:
 * every page here is sent with `frame-ancestors 'none'`, and a card that
 * degrades to a quote and a link is what WordPress emits for the same reason.
 */
export const OEmbedController = {
  async show(req: Request, res: Response) {
    const format = req.query.format || 'json'
    // The spec's answer to a format the provider does not speak.
    if (format !== 'json') return res.json({ error: 'Only format=json is supported' }, 501)

    const site = siteUrl(req)
    const target = parseTarget(req.query.url, site)
    if (!target) return res.json({ error: 'Not found' }, 404)

    const found = await lookup(target)
    if (!found) return res.json({ error: 'Not found' }, 404)

    const body = resolveOEmbed({
      ...found,
      url: `${site}${target.path}`,
      providerName: (await Settings.getSiteName()),
      providerUrl: site,
      maxWidth: positive(req.query.maxwidth),
      maxHeight: positive(req.query.maxheight)
    })

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    const json = JSON.stringify(body)
    if (conditional(req, res, { etag: strongEtag(json), cacheControl: 'public, max-age=60' })) return
    ;(res as unknown as { end: (body: string) => void }).end(json)
  }
}

function positive(value: unknown): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? Math.min(n, 4000) : null
}

/**
 * The path of a URL on this site, or null.
 *
 * Compared by origin, so `https://site.example/blog/x?utm=1#top` is ours and
 * `https://site.example.evil.test/blog/x` is not. With no configured site URL
 * (production without SITE_URL/APP_URL) there is no "this site" to compare
 * with, and nothing is answered.
 */
export function parseTarget(raw: unknown, site: string): { path: string; segments: string[] } | null {
  if (typeof raw !== 'string' || !site) return null

  let url: URL
  let origin: string
  try {
    url = new URL(raw)
    origin = new URL(site).origin
  } catch {
    return null
  }

  if (url.origin !== origin) return null

  const path = url.pathname.replace(/\/+$/, '') || '/'
  const segments = path.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  })

  return { path, segments }
}

/** What lives at that path: a post, an entry of a custom type, or a page. */
async function lookup(target: { segments: string[] }): Promise<OEmbedTarget | null> {
  const [first, second, ...rest] = target.segments
  if (!first || rest.length) return null

  if (second !== undefined) {
    const type = `/${first}` === POST_ROUTE_BASE
      ? await ContentType.findByKey('post')
      : await ContentType.findByRouteBase(`/${first}`)
    if (!type || !type.public) return null

    const post = await PublicContent.post(second, 'html', { type: type.key })
    // Only at its own slug: a post reached by id has one canonical URL, and
    // that is what an embed should name.
    if (!post || post.slug !== second) return null

    return {
      kind: 'rich',
      title: post.title,
      description: post.excerpt,
      authorName: post.author_profile?.name ?? post.author,
      authorUrl: post.author_profile?.slug ? `/author/${post.author_profile.slug}` : null,
      thumbnail: post.featured_image
        ? { url: post.featured_image.url, width: post.featured_image.width, height: post.featured_image.height }
        : post.og.image_url ? { url: post.og.image_url, width: null, height: null } : null
    }
  }

  const page = await PublicContent.page(first)
  if (!page || page.slug !== first) return null

  return {
    kind: 'link',
    title: page.title,
    description: page.meta_description,
    authorName: null,
    authorUrl: null,
    thumbnail: page.featured_image
      ? { url: page.featured_image.url, width: page.featured_image.width, height: page.featured_image.height }
      : null
  }
}
