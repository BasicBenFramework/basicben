import { getDb } from '@basicbenframework/core/db'
import { Settings } from '../models/Settings'
import type { Request, Response } from '../types'

interface FeedPost {
  id: number
  title: string
  slug: string
  content: string
  excerpt: string
  author_name: string
  created_at: string
  updated_at: string
}

export const FeedController = {
  async rss(req: Request, res: Response) {
    const db = await getDb()
    const siteName = await Settings.getSiteName()
    const siteDescription = await Settings.getSiteDescription()
    const siteUrl = req.headers.host ? `https://${req.headers.host}` : 'http://localhost:3000'

    const posts: FeedPost[] = await db.all(`
      SELECT p.id, p.title, p.slug, p.content, p.excerpt, p.created_at, p.updated_at,
             u.name as author_name
      FROM posts p
      JOIN users u ON u.id = p.user_id
      WHERE p.published = 1
      ORDER BY p.created_at DESC
      LIMIT 20
    `)

    const lastBuildDate = posts.length > 0
      ? new Date(posts[0].created_at).toUTCString()
      : new Date().toUTCString()

    const items = posts.map(post => {
      const link = `${siteUrl}/blog/${post.slug || post.id}`
      const description = post.excerpt || truncate(stripHtml(post.content), 300)
      const pubDate = new Date(post.created_at).toUTCString()

      return `
    <item>
      <title><![CDATA[${escapeXml(post.title)}]]></title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description><![CDATA[${description}]]></description>
      <pubDate>${pubDate}</pubDate>
      <author>${escapeXml(post.author_name)}</author>
    </item>`
    }).join('')

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title><![CDATA[${escapeXml(siteName)}]]></title>
    <description><![CDATA[${escapeXml(siteDescription)}]]></description>
    <link>${siteUrl}</link>
    <atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <language>en-us</language>
    ${items}
  </channel>
</rss>`

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8')
    res.end(xml)
  },

  async json(req: Request, res: Response) {
    const db = await getDb()
    const siteName = await Settings.getSiteName()
    const siteDescription = await Settings.getSiteDescription()
    const siteUrl = req.headers.host ? `https://${req.headers.host}` : 'http://localhost:3000'

    const posts: FeedPost[] = await db.all(`
      SELECT p.id, p.title, p.slug, p.content, p.excerpt, p.created_at, p.updated_at,
             u.name as author_name
      FROM posts p
      JOIN users u ON u.id = p.user_id
      WHERE p.published = 1
      ORDER BY p.created_at DESC
      LIMIT 20
    `)

    const items = posts.map(post => ({
      id: `${siteUrl}/blog/${post.slug || post.id}`,
      url: `${siteUrl}/blog/${post.slug || post.id}`,
      title: post.title,
      content_text: stripHtml(post.content),
      content_html: post.content,
      summary: post.excerpt || truncate(stripHtml(post.content), 300),
      date_published: new Date(post.created_at).toISOString(),
      date_modified: new Date(post.updated_at).toISOString(),
      author: {
        name: post.author_name
      }
    }))

    const feed = {
      version: 'https://jsonfeed.org/version/1.1',
      title: siteName,
      description: siteDescription,
      home_page_url: siteUrl,
      feed_url: `${siteUrl}/feed.json`,
      items
    }

    res.json(feed)
  },

  async sitemap(req: Request, res: Response) {
    const db = await getDb()
    const siteUrl = req.headers.host ? `https://${req.headers.host}` : 'http://localhost:3000'

    const posts = await db.all(`
      SELECT id, slug, updated_at FROM posts WHERE published = 1
    `)

    const pages = await db.all(`
      SELECT id, slug, updated_at FROM pages WHERE published = 1
    `)

    const categories = await db.all('SELECT id, slug FROM categories')

    const urls = [
      // Home page
      `  <url>
    <loc>${siteUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`,

      // Posts
      ...posts.map((post: { id: number; slug: string; updated_at: string }) => `  <url>
    <loc>${siteUrl}/blog/${post.slug || post.id}</loc>
    <lastmod>${new Date(post.updated_at).toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`),

      // Pages
      ...pages.map((page: { id: number; slug: string; updated_at: string }) => `  <url>
    <loc>${siteUrl}/${page.slug}</loc>
    <lastmod>${new Date(page.updated_at).toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`),

      // Categories
      ...categories.map((cat: { id: number; slug: string }) => `  <url>
    <loc>${siteUrl}/category/${cat.slug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`)
    ]

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`

    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.end(xml)
  }
}

// Helper functions
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

function truncate(text: string, length: number): string {
  if (text.length <= length) return text
  return text.slice(0, length).trim() + '...'
}
