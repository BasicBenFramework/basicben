import { getDb } from '@basicbenframework/core/db'
import { Settings } from '../models/Settings.ts'
import { livePost, livePage, parseStoredTimestamp } from '../models/visibility.ts'
import { siteUrl } from '../helpers/site.ts'
import { isGated, gatedFeedHtml, publicExcerpt } from '../helpers/gating.ts'
import { excerpt as plainText } from '@basicbenframework/core/content'
import { ContentType } from '../models/ContentType.ts'
import { entryPath } from '../helpers/content-paths.ts'
import type { Request, Response } from '../types/index.ts'

interface FeedPost {
  id: number
  title: string
  slug: string
  content_html: string | null
  content: string
  excerpt: string | null
  author_name: string
  published_at: string
  updated_at: string
  visibility: string | null
}

/** What a feed has been narrowed to, if anything. */
interface FeedScope {
  where: string[]
  params: unknown[]
  /** Appended to the feed's title: "Site — Category". */
  label: string | null
  /** The feed's own query string, for its self link. */
  query: string
}

/**
 * Narrow a feed to one category, tag or author.
 *
 * `?category=`, `?tag=` and `?author=` take a slug, the way WordPress's
 * `/category/x/feed/` and Ghost's `/tag/x/rss/` do. Query parameters rather
 * than path segments so one route serves every combination. An unknown slug
 * gives null — an empty feed would look like a working one.
 */
async function scopeFrom(req: Request): Promise<FeedScope | null> {
  const db = await getDb()
  const query = req.query as Record<string, string | undefined>
  const scope: FeedScope = { where: [], params: [], label: null, query: '' }
  const parts: string[] = []

  if (query.category) {
    const category = await db.get('SELECT id, name FROM categories WHERE slug = ?', [query.category])
    if (!category) return null
    scope.where.push('(p.category_id = ? OR p.id IN (SELECT post_id FROM post_categories WHERE category_id = ?))')
    scope.params.push(category.id, category.id)
    scope.label = category.name
    parts.push(`category=${encodeURIComponent(query.category)}`)
  }

  if (query.tag) {
    const tag = await db.get('SELECT id, name FROM tags WHERE slug = ?', [query.tag])
    if (!tag) return null
    scope.where.push('p.id IN (SELECT post_id FROM post_tags WHERE tag_id = ?)')
    scope.params.push(tag.id)
    scope.label = tag.name
    parts.push(`tag=${encodeURIComponent(query.tag)}`)
  }

  if (query.author) {
    const author = await db.get('SELECT id, name FROM users WHERE slug = ?', [query.author])
    if (!author) return null
    scope.where.push('p.user_id = ?')
    scope.params.push(author.id)
    scope.label = author.name
    parts.push(`author=${encodeURIComponent(query.author)}`)
  }

  scope.query = parts.length ? `?${parts.join('&')}` : ''
  return scope
}

async function feedPosts(scope: FeedScope): Promise<FeedPost[]> {
  const db = await getDb()
  // Blog posts only. A feed subscriber signed up for the blog; recipes or
  // products arriving in their reader is the kind of surprise that ends in
  // an unsubscribe. Custom types are in the sitemap and the content API.
  const where = [livePost('p'), "p.post_type = 'post'", ...scope.where].join(' AND ')

  const rows: FeedPost[] = await db.all(`
    SELECT p.id, p.title, p.slug, p.content, p.content_html, p.excerpt, p.updated_at, p.visibility,
           COALESCE(p.publish_at, p.created_at) AS published_at,
           u.name as author_name
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE ${where}
    ORDER BY COALESCE(p.publish_at, p.created_at) DESC
    LIMIT 20
  `, scope.params)

  // A feed is public — readers and aggregators fetch it with no session — so
  // a restricted post appears with its excerpt and a pointer, never its
  // body. Done here, once, so neither format can forget. See helpers/gating.ts.
  return rows.map(row => isGated(row.visibility)
    ? (() => {
        const excerpt = publicExcerpt(row.excerpt, plainText(row.content ?? '', Number.MAX_SAFE_INTEGER), row.visibility, null)
        return { ...row, excerpt, content: '', content_html: gatedFeedHtml(excerpt) }
      })()
    : row)
}

export const FeedController = {
  async rss(req: Request, res: Response) {
    const scope = await scopeFrom(req)
    if (!scope) return res.json({ error: 'Feed not found' }, 404)

    const siteName = await Settings.getSiteName()
    const siteDescription = await Settings.getSiteDescription()
    const site = siteUrl(req)
    const posts = await feedPosts(scope)
    const title = scope.label ? `${siteName} — ${scope.label}` : siteName

    const lastBuildDate = posts.length > 0
      ? new Date(posts[0].published_at).toUTCString()
      : new Date().toUTCString()

    const items = posts.map(post => {
      const link = `${site}/blog/${post.slug || post.id}`
      const html = post.content_html ?? ''
      const description = post.excerpt || truncate(stripHtml(html), 300)

      // Text goes through escapeXml and nothing else. The HTML body goes in a
      // CDATA section, which cannot contain its own terminator — so any `]]>`
      // in it is split across two sections rather than ending this one early
      // and letting the rest be read as markup.
      return `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <description>${escapeXml(description)}</description>
      <content:encoded>${cdata(html)}</content:encoded>
      <pubDate>${new Date(post.published_at).toUTCString()}</pubDate>
      <dc:creator>${escapeXml(post.author_name)}</dc:creator>
    </item>`
    }).join('')

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(title)}</title>
    <description>${escapeXml(siteDescription)}</description>
    <link>${escapeXml(site)}</link>
    <atom:link href="${escapeXml(`${site}/feed.xml${scope.query}`)}" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <language>en-us</language>
    ${items}
  </channel>
</rss>`

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8')
    res.end(xml)
  },

  async json(req: Request, res: Response) {
    const scope = await scopeFrom(req)
    if (!scope) return res.json({ error: 'Feed not found' }, 404)

    const siteName = await Settings.getSiteName()
    const siteDescription = await Settings.getSiteDescription()
    const site = siteUrl(req)
    const posts = await feedPosts(scope)

    const items = posts.map(post => {
      // The sanitized render, never the Markdown source. The source may hold
      // raw HTML, and a feed reader displays content_html as HTML.
      const html = post.content_html ?? ''
      const text = stripHtml(html)

      return {
        id: `${site}/blog/${post.slug || post.id}`,
        url: `${site}/blog/${post.slug || post.id}`,
        title: post.title,
        content_text: text,
        content_html: html,
        summary: post.excerpt || truncate(text, 300),
        date_published: new Date(post.published_at).toISOString(),
        date_modified: new Date(post.updated_at).toISOString(),
        authors: [{ name: post.author_name }]
      }
    })

    res.json({
      version: 'https://jsonfeed.org/version/1.1',
      title: scope.label ? `${siteName} — ${scope.label}` : siteName,
      description: siteDescription,
      home_page_url: site,
      feed_url: `${site}/feed.json${scope.query}`,
      items
    })
  },

  async sitemap(req: Request, res: Response) {
    const db = await getDb()
    const site = siteUrl(req)

    // `noindex` content is left out: asking a search engine not to index a
    // page and then listing it for them is two contradictory instructions.
    const posts = await db.all(`
      SELECT p.id, p.slug, p.updated_at, p.canonical_url FROM posts p
      WHERE ${livePost('p')} AND p.post_type = 'post' AND (p.noindex IS NULL OR p.noindex = 0)
    `)

    // Every other public content type, at its own route base. A type that is
    // not public has no pages to index, so it is left out with its entries.
    const customTypes = (await ContentType.all({ publicOnly: true })).filter((type) => type.key !== 'post')
    const entries = customTypes.length
      ? await db.all(`
          SELECT p.id, p.slug, p.updated_at, p.post_type, p.canonical_url FROM posts p
          WHERE ${livePost('p')} AND p.post_type IN (${customTypes.map(() => '?').join(', ')})
            AND (p.noindex IS NULL OR p.noindex = 0)
        `, customTypes.map((type) => type.key))
      : []
    const baseOf = (key: string) => customTypes.find((type) => type.key === key)?.route_base ?? null

    const pages = await db.all(`
      SELECT id, slug, updated_at, canonical_url FROM pages
      WHERE ${livePage('pages')} AND (noindex IS NULL OR noindex = 0)
    `)

    // Only categories with something live in them: an empty archive is a
    // thin page, and the theme answers it with "Nothing here yet". Its
    // lastmod is its newest post's.
    const categories = await db.all(`
      SELECT c.slug, MAX(p.updated_at) AS updated_at FROM categories c
      JOIN post_categories pc ON pc.category_id = c.id
      JOIN posts p ON p.id = pc.post_id
      WHERE ${livePost('p')} AND p.post_type = 'post'
      GROUP BY c.id, c.slug
    `)

    const url = (loc: string, extra = '') => `  <url>
    <loc>${escapeXml(loc)}</loc>${extra}
  </url>`
    // Stored timestamps may be bare SQLite UTC ("2026-01-02 03:04:05"), which
    // new Date() would read as local time; an unparseable one is left out
    // rather than failing the whole sitemap.
    const lastmod = (value: string | null) => {
      const time = parseStoredTimestamp(value)
      return Number.isNaN(time) ? '' : `
    <lastmod>${new Date(time).toISOString()}</lastmod>`
    }

    // A sitemap lists canonical URLs. An entry whose canonical points
    // somewhere else (first published there) is that other page's to list.
    type Row = { id: number; slug: string; updated_at: string; canonical_url?: string | null }
    const own = (row: Row, loc: string) => !row.canonical_url || row.canonical_url === loc

    const entryUrls = [
      ...posts.map((post: Row) => ({ row: post, loc: `${site}/blog/${post.slug || post.id}` })),
      ...entries.map((entry: Row & { post_type: string }) =>
        ({ row: entry, loc: `${site}${entryPath(baseOf(entry.post_type), entry.slug, entry.id)}` })),
      ...pages.map((page: Row) => ({ row: page, loc: `${site}/${page.slug}` }))
    ].filter(({ row, loc }) => own(row, loc))

    const urls = [
      url(`${site}/`, '\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>'),
      ...entryUrls.map(({ row, loc }) => url(loc, lastmod(row.updated_at))),
      ...categories.map((cat: { slug: string; updated_at: string }) =>
        url(`${site}/category/${cat.slug}`, lastmod(cat.updated_at)))
    ]

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`

    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.end(xml)
  },

  /**
   * robots.txt.
   *
   * Points crawlers at the sitemap and keeps them out of the admin and the
   * API. A custom body from settings replaces the rules entirely, for a site
   * that needs rules this cannot guess; if it names no sitemap, this one is
   * added, since a hand-written file that forgets it costs the site its
   * sitemap discovery for no gain.
   *
   * `/admin` is matched exactly and as a folder: a bare `Disallow: /admin`
   * is a prefix, and would also hide a page whose slug starts with "admin".
   */
  async robots(req: Request, res: Response) {
    const custom = await Settings.get('robots_txt')
    const site = siteUrl(req)
    const sitemap = `Sitemap: ${site}/sitemap.xml`

    let body: string
    if (typeof custom === 'string' && custom.trim()) {
      body = custom.trim()
      if (!/^\s*sitemap\s*:/im.test(body)) body += `\n\n${sitemap}`
    } else {
      body = [
        'User-agent: *',
        'Disallow: /admin$',
        'Disallow: /admin/',
        'Disallow: /api/',
        'Allow: /api/v1/',
        '',
        sitemap
      ].join('\n')
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end(body + '\n')
  }
}

function escapeXml(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** A CDATA section that its content cannot close. */
function cdata(text: string): string {
  return `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function truncate(text: string, length: number): string {
  if (text.length <= length) return text
  return text.slice(0, length).trim() + '...'
}
