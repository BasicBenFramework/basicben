/**
 * Queries for the public content API.
 *
 * Separate from the admin models on purpose. Every column reaching an anonymous
 * or token-bearing reader is named here, so adding a column to `posts` cannot
 * quietly publish it — which is exactly what `SELECT posts.*` plus a list of
 * fields to strip would do. The admin models keep using `*`; they answer to a
 * signed-in user whose role was already checked.
 *
 * Comments are absent from this surface deliberately: the table stores
 * `author_email` for unauthenticated commenters, and a public feed of reader
 * email addresses is a data-protection incident rather than a feature.
 */

import { getDb } from '@basicbenframework/core/db'
import { getStorage } from '@basicbenframework/core/storage'

export type ContentFormat = 'html' | 'markdown'

export interface PublicPost {
  id: number
  slug: string | null
  title: string
  excerpt: string | null
  content: string
  format: ContentFormat
  featured_image_url: string | null
  author: string | null
  category: { id: number; name: string; slug: string } | null
  tags: Array<{ id: number; name: string; slug: string }>
  meta_title: string | null
  meta_description: string | null
  published_at: string
  updated_at: string
}

interface PostRow {
  id: number
  slug: string | null
  title: string
  excerpt: string | null
  content: string
  content_html: string | null
  featured_image_path: string | null
  author_name: string | null
  category_id: number | null
  category_name: string | null
  category_slug: string | null
  meta_title: string | null
  meta_description: string | null
  created_at: string
  updated_at: string
}

/** Named once so the list and single-item queries cannot drift apart. */
const POST_COLUMNS = `
  posts.id,
  posts.slug,
  posts.title,
  posts.excerpt,
  posts.content,
  posts.content_html,
  posts.meta_title,
  posts.meta_description,
  posts.created_at,
  posts.updated_at,
  users.name AS author_name,
  categories.id AS category_id,
  categories.name AS category_name,
  categories.slug AS category_slug,
  media.path AS featured_image_path
`

const POST_JOINS = `
  FROM posts
  JOIN users ON posts.user_id = users.id
  LEFT JOIN categories ON categories.id = posts.category_id
  LEFT JOIN media ON media.id = posts.featured_image
`

const MAX_PER_PAGE = 100

/** Clamp paging so a consumer cannot ask for the whole table in one request. */
export function paging(query: Record<string, string>) {
  const page = Math.max(1, Number(query.page) || 1)
  const requested = Number(query.per_page) || 10
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, requested))

  return { page, perPage, offset: (page - 1) * perPage }
}

/** `?format=markdown` returns the source; anything else returns rendered HTML. */
export function contentFormat(query: Record<string, string>): ContentFormat {
  return query.format === 'markdown' ? 'markdown' : 'html'
}

export const PublicContent = {
  /**
   * Published posts, newest first.
   *
   * Filtering happens in SQL rather than over the page that happened to load —
   * filtering a page client-side gives an answer that depends on the page size,
   * which is a bug that only shows up once there is enough content.
   */
  async posts(
    options: {
      page?: number
      perPage?: number
      offset?: number
      category?: string
      tag?: string
      search?: string
      format?: ContentFormat
    } = {}
  ): Promise<{ posts: PublicPost[]; total: number }> {
    const db = await getDb()
    const { perPage = 10, offset = 0, category, tag, search, format = 'html' } = options

    const where: string[] = ['posts.published = 1']
    const params: unknown[] = []

    if (category) {
      // Accepts a slug or an id, because a consumer holding either should not
      // have to look the other up first.
      where.push('(categories.slug = ? OR categories.id = ?)')
      params.push(category, Number(category) || -1)
    }

    if (tag) {
      where.push(`posts.id IN (
        SELECT pt.post_id FROM post_tags pt
        JOIN tags ON tags.id = pt.tag_id
        WHERE tags.slug = ? OR tags.id = ?
      )`)
      params.push(tag, Number(tag) || -1)
    }

    if (search) {
      where.push('(posts.title LIKE ? OR posts.excerpt LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }

    const clause = `WHERE ${where.join(' AND ')}`

    const counted = (await db.get(
      `SELECT COUNT(*) AS total ${POST_JOINS} ${clause}`,
      params
    )) as { total: number } | undefined

    const rows = (await db.all(
      `SELECT ${POST_COLUMNS} ${POST_JOINS} ${clause}
       ORDER BY posts.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    )) as PostRow[]

    return {
      posts: await shapePosts(rows, format),
      total: Number(counted?.total) || 0
    }
  },

  /**
   * One published post, by slug or id.
   *
   * Slugs are nullable on posts — the column was added after the table — so a
   * post that never got one is still reachable by id rather than invisible.
   */
  async post(identifier: string, format: ContentFormat = 'html'): Promise<PublicPost | null> {
    const db = await getDb()

    const row = (await db.get(
      `SELECT ${POST_COLUMNS} ${POST_JOINS}
       WHERE posts.published = 1 AND (posts.slug = ? OR posts.id = ?)`,
      [identifier, Number(identifier) || -1]
    )) as PostRow | undefined

    if (!row) return null

    return (await shapePosts([row], format))[0]
  },

  /** Published pages, newest first. */
  async pages(
    options: { perPage?: number; offset?: number; format?: ContentFormat } = {}
  ): Promise<{ pages: PublicPage[]; total: number }> {
    const db = await getDb()
    const { perPage = 10, offset = 0, format = 'html' } = options

    const counted = (await db.get(
      'SELECT COUNT(*) AS total FROM pages WHERE published = 1'
    )) as { total: number } | undefined

    const rows = (await db.all(
      `SELECT id, slug, title, content, content_html, meta_title, meta_description,
              created_at, updated_at
       FROM pages WHERE published = 1
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [perPage, offset]
    )) as PageRow[]

    return { pages: rows.map((row) => shapePage(row, format)), total: Number(counted?.total) || 0 }
  },

  /** One published page, by slug or id. */
  async page(identifier: string, format: ContentFormat = 'html'): Promise<PublicPage | null> {
    const db = await getDb()

    const row = (await db.get(
      `SELECT id, slug, title, content, content_html, meta_title, meta_description,
              created_at, updated_at
       FROM pages WHERE published = 1 AND (slug = ? OR id = ?)`,
      [identifier, Number(identifier) || -1]
    )) as PageRow | undefined

    return row ? shapePage(row, format) : null
  },

  /** Categories that have at least one published post, with their counts. */
  async categories() {
    const db = await getDb()

    return db.all(`
      SELECT c.id, c.name, c.slug, c.description,
             COUNT(p.id) AS post_count
      FROM categories c
      LEFT JOIN posts p ON p.category_id = c.id AND p.published = 1
      GROUP BY c.id, c.name, c.slug, c.description
      ORDER BY c.name ASC
    `)
  },

  /** Tags with their published-post counts. */
  async tags() {
    const db = await getDb()

    return db.all(`
      SELECT t.id, t.name, t.slug,
             COUNT(p.id) AS post_count
      FROM tags t
      LEFT JOIN post_tags pt ON pt.tag_id = t.id
      LEFT JOIN posts p ON p.id = pt.post_id AND p.published = 1
      GROUP BY t.id, t.name, t.slug
      ORDER BY t.name ASC
    `)
  },

  /**
   * One media item.
   *
   * `uploaded_by` and the original filename stay internal — a consumer needs
   * the URL, the dimensions and the alt text, not who uploaded it.
   */
  async media(id: number) {
    const db = await getDb()

    const row = (await db.get(
      `SELECT id, path, mime_type, size, alt_text, created_at
       FROM media WHERE id = ?`,
      [id]
    )) as
      | { id: number; path: string; mime_type: string; size: number; alt_text: string | null; created_at: string }
      | undefined

    if (!row) return null

    const storage = await getStorage()

    return {
      id: row.id,
      url: storage.url(row.path),
      mime_type: row.mime_type,
      size: row.size,
      alt_text: row.alt_text,
      created_at: row.created_at
    }
  }
}

export interface PublicPage {
  id: number
  slug: string
  title: string
  content: string
  format: ContentFormat
  meta_title: string | null
  meta_description: string | null
  published_at: string
  updated_at: string
}

interface PageRow {
  id: number
  slug: string
  title: string
  content: string
  content_html: string | null
  meta_title: string | null
  meta_description: string | null
  created_at: string
  updated_at: string
}

/**
 * Attach tags and resolve image URLs for a batch of posts.
 *
 * Tags come back in one query for the whole page rather than one per post — the
 * N+1 here would be invisible on a seeded database and painful on a real one.
 */
async function shapePosts(rows: PostRow[], format: ContentFormat): Promise<PublicPost[]> {
  if (rows.length === 0) return []

  const db = await getDb()
  const ids = rows.map((row) => row.id)
  const placeholders = ids.map(() => '?').join(', ')

  const tagRows = (await db.all(
    `SELECT pt.post_id, t.id, t.name, t.slug
     FROM post_tags pt
     JOIN tags t ON t.id = pt.tag_id
     WHERE pt.post_id IN (${placeholders})`,
    ids
  )) as Array<{ post_id: number; id: number; name: string; slug: string }>

  const byPost = new Map<number, Array<{ id: number; name: string; slug: string }>>()

  for (const tag of tagRows) {
    const list = byPost.get(tag.post_id) ?? []
    list.push({ id: tag.id, name: tag.name, slug: tag.slug })
    byPost.set(tag.post_id, list)
  }

  const storage = rows.some((row) => row.featured_image_path) ? await getStorage() : null

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    ...contentFor(row.content, row.content_html, format),
    featured_image_url:
      row.featured_image_path && storage ? storage.url(row.featured_image_path) : null,
    author: row.author_name,
    category: row.category_id
      ? { id: row.category_id, name: row.category_name!, slug: row.category_slug! }
      : null,
    tags: byPost.get(row.id) ?? [],
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    published_at: row.created_at,
    updated_at: row.updated_at
  }))
}

function shapePage(row: PageRow, format: ContentFormat): PublicPage {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    ...contentFor(row.content, row.content_html, format),
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    published_at: row.created_at,
    updated_at: row.updated_at
  }
}

/**
 * The content in the requested format, and the format actually returned.
 *
 * `content` is the Markdown source and is always present; `content_html` is a
 * cache of it that can be missing on rows written before rendering existed
 * (the column arrived in migration 017). Two wrong answers were available
 * there: return an empty string, losing the post silently, or return Markdown
 * while labelling it HTML, which a consumer would inject into a page as markup.
 *
 * So it falls back to the source *and* says so. A consumer that cares can check
 * `format`; one that does not still gets the words. Running
 * `basicben content:rerender` fills the cache and the fallback stops firing.
 */
function contentFor(
  markdown: string,
  html: string | null,
  format: ContentFormat
): { content: string; format: ContentFormat } {
  if (format === 'markdown') return { content: markdown, format: 'markdown' }

  if (html) return { content: html, format: 'html' }

  return { content: markdown, format: 'markdown' }
}
