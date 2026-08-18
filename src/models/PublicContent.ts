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
import { getStorage, absoluteUrl } from '@basicbenframework/core/storage'

export type ContentFormat = 'html' | 'markdown'

/**
 * A post as the content API returns it.
 *
 * The field comments here are the API reference: `scripts/generate-api-reference.js`
 * reads this file and emits the table the docs render, so the description a
 * consumer sees is the one sitting next to the field. Writing that table by
 * hand would make it a second place for the shape to drift, and prose drifts
 * silently.
 */
export interface PublicPost {
  /** Stable identifier. Accepted anywhere a slug is. */
  id: number
  /** URL segment. Null on posts written before slugs existed. */
  slug: string | null
  /** Plain text, never markup. */
  title: string
  /** Short summary, if the author wrote one. */
  excerpt: string | null
  /** The body, in whichever `format` this item reports. */
  content: string
  /** What `content` actually is — not what you asked for. See `?format=`. */
  format: ContentFormat
  /** Absolute URL of the featured image, or null. */
  featured_image_url: string | null
  /** The author's display name. Never their address. */
  author: string | null
  /** Every category on the post. Empty when uncategorised. */
  categories: Array<{ id: number; name: string; slug: string }>
  /** Every tag on the post. Empty when untagged. */
  tags: Array<{ id: number; name: string; slug: string }>
  /** SEO title override, if set. */
  meta_title: string | null
  /** SEO description override, if set. */
  meta_description: string | null
  /** When it was created, ISO 8601. Posts are ordered by this, newest first. */
  published_at: string
  /** When it last changed, ISO 8601. */
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
  media.path AS featured_image_path
`

const POST_JOINS = `
  FROM posts
  JOIN users ON posts.user_id = users.id
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
      // Matches on *any* of the post's categories, not just its primary one —
      // a post filed under both "AI" and "Jobs" belongs in either listing.
      // Accepts a slug or an id, because a consumer holding either should not
      // have to look the other up first.
      where.push(`posts.id IN (
        SELECT pc.post_id FROM post_categories pc
        JOIN categories ON categories.id = pc.category_id
        WHERE categories.slug = ? OR categories.id = ?
      )`)
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

  /**
   * Every category, with how many published posts sit in it.
   *
   * Categories with no published posts are still listed, with a count of zero.
   * A consumer building navigation wants the empty ones visible rather than
   * having to discover them by fetching posts.
   */
  async categories(): Promise<PublicCategory[]> {
    const db = await getDb()

    const rows = (await db.all(`
      SELECT c.id, c.name, c.slug, c.description,
             COUNT(p.id) AS post_count
      FROM categories c
      LEFT JOIN post_categories pc ON pc.category_id = c.id
      LEFT JOIN posts p ON p.id = pc.post_id AND p.published = 1
      GROUP BY c.id, c.name, c.slug, c.description
      ORDER BY c.name ASC
    `)) as Array<Omit<PublicCategory, 'post_count'> & { post_count: number | string }>

    return rows.map((row) => ({ ...row, post_count: Number(row.post_count) || 0 }))
  },

  /** Tags with their published-post counts. */
  async tags(): Promise<PublicTag[]> {
    const db = await getDb()

    const rows = (await db.all(`
      SELECT t.id, t.name, t.slug,
             COUNT(p.id) AS post_count
      FROM tags t
      LEFT JOIN post_tags pt ON pt.tag_id = t.id
      LEFT JOIN posts p ON p.id = pt.post_id AND p.published = 1
      GROUP BY t.id, t.name, t.slug
      ORDER BY t.name ASC
    `)) as Array<Omit<PublicTag, 'post_count'> & { post_count: number | string }>

    return rows.map((row) => ({ ...row, post_count: Number(row.post_count) || 0 }))
  },

  /** One media item. */
  async media(id: number): Promise<PublicMedia | null> {
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
      url: mediaUrl(storage, row.path),
      mime_type: row.mime_type,
      size: row.size,
      alt_text: row.alt_text,
      created_at: row.created_at
    }
  }
}

/** A page as the content API returns it. A post without the blog machinery. */
export interface PublicPage {
  /** Stable identifier. Accepted anywhere a slug is. */
  id: number
  /** URL segment. Required on pages, unlike posts. */
  slug: string
  /** Plain text, never markup. */
  title: string
  /** The body, in whichever `format` this item reports. */
  content: string
  /** What `content` actually is — not what you asked for. See `?format=`. */
  format: ContentFormat
  /** SEO title override, if set. */
  meta_title: string | null
  /** SEO description override, if set. */
  meta_description: string | null
  /** When it was created, ISO 8601. */
  published_at: string
  /** When it last changed, ISO 8601. */
  updated_at: string
}

/** A category, with how many published posts sit in it. */
export interface PublicCategory {
  /** Stable identifier. */
  id: number
  /** Display name. */
  name: string
  /** URL segment. Accepted by `?category=`. */
  slug: string
  /** Longer description, if one was written. */
  description: string | null
  /** Published posts in this category. Zero is returned, not omitted. */
  post_count: number
}

/** A tag, with how many published posts carry it. */
export interface PublicTag {
  /** Stable identifier. */
  id: number
  /** Display name. */
  name: string
  /** URL segment. Accepted by `?tag=`. */
  slug: string
  /** Published posts carrying this tag. */
  post_count: number
}

/**
 * A media item.
 *
 * `uploaded_by` and the original filename stay internal — a consumer needs the
 * URL, the type and the alt text, not who uploaded it.
 */
export interface PublicMedia {
  /** Stable identifier. */
  id: number
  /** Absolute URL of the file. */
  url: string
  /** MIME type as recorded at upload. */
  mime_type: string
  /** Size in bytes. */
  size: number
  /** Alt text, if an editor supplied one. */
  alt_text: string | null
  /** When it was uploaded, ISO 8601. */
  created_at: string
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

/** Warned about once per process; a per-request warning would be a log flood. */
let warnedAboutRelativeMedia = false

/**
 * A media URL a consumer somewhere else can actually fetch.
 *
 * The adapter method is `publicUrl`. This surface called `storage.url`, which
 * neither adapter has ever defined, so every media read and every post carrying
 * a featured image threw a TypeError. It went unnoticed because the smoke test
 * only ever checked that a `content:read` token is refused `/api/v1/media` —
 * a scope failure returns before the controller runs.
 *
 * The URL is then resolved against `APP_URL`, because the local driver serves
 * from the app's own origin and returns `/uploads/...`. That is correct for the
 * bundled frontend and meaningless to a static build on another host. Refusing
 * to serve media at all under the local driver was the other option; it makes
 * the same-origin case worse and tells the consumer nothing, where an absolute
 * URL at least works whenever the app is reachable.
 */
function mediaUrl(storage: { publicUrl: (key: string) => string }, path: string): string {
  const url = absoluteUrl(storage.publicUrl(path))

  if (!warnedAboutRelativeMedia && url.startsWith('/')) {
    warnedAboutRelativeMedia = true
    console.warn(
      `[api] Serving relative media URLs (${url}). A consumer on another origin ` +
        'cannot resolve them — set APP_URL, or configure object storage with a publicUrl.'
    )
  }

  return url
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

  const group = (
    rowsFor: Array<{ post_id: number; id: number; name: string; slug: string }>
  ) => {
    const byPost = new Map<number, Array<{ id: number; name: string; slug: string }>>()

    for (const row of rowsFor) {
      const list = byPost.get(row.post_id) ?? []
      list.push({ id: row.id, name: row.name, slug: row.slug })
      byPost.set(row.post_id, list)
    }

    return byPost
  }

  // Both in one query each for the whole page rather than one per post: the
  // N+1 here is invisible on a seeded database and painful on a real one.
  const tagsByPost = group(
    (await db.all(
      `SELECT pt.post_id, t.id, t.name, t.slug
       FROM post_tags pt
       JOIN tags t ON t.id = pt.tag_id
       WHERE pt.post_id IN (${placeholders})
       ORDER BY t.name ASC`,
      ids
    )) as Array<{ post_id: number; id: number; name: string; slug: string }>
  )

  const categoriesByPost = group(
    (await db.all(
      `SELECT pc.post_id, c.id, c.name, c.slug
       FROM post_categories pc
       JOIN categories c ON c.id = pc.category_id
       WHERE pc.post_id IN (${placeholders})
       ORDER BY c.name ASC`,
      ids
    )) as Array<{ post_id: number; id: number; name: string; slug: string }>
  )

  const storage = rows.some((row) => row.featured_image_path) ? await getStorage() : null

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    ...contentFor(row.content, row.content_html, format),
    featured_image_url:
      row.featured_image_path && storage ? mediaUrl(storage, row.featured_image_path) : null,
    author: row.author_name,
    categories: categoriesByPost.get(row.id) ?? [],
    tags: tagsByPost.get(row.id) ?? [],
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
