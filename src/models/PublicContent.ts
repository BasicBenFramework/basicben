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
  /** The author's profile — biography, link and avatar. Null if the account is gone. */
  author_profile: { id: number; name: string; slug: string | null; bio: string | null; website: string | null; avatar_url: string | null } | null
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
  author_id: number | null
  author_name: string | null
  author_slug: string | null
  author_bio: string | null
  author_website: string | null
  author_avatar_path: string | null
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
  users.id AS author_id,
  users.name AS author_name,
  users.slug AS author_slug,
  users.bio AS author_bio,
  users.website AS author_website,
  avatars.path AS author_avatar_path,
  media.path AS featured_image_path
`

const POST_JOINS = `
  FROM posts
  JOIN users ON posts.user_id = users.id
  LEFT JOIN media ON media.id = posts.featured_image
  LEFT JOIN media AS avatars ON avatars.id = users.avatar_id
`

/** The same for pages, which carry a featured image of their own now. */
const PAGE_COLUMNS = `
  pages.id,
  pages.slug,
  pages.title,
  pages.content,
  pages.content_html,
  pages.meta_title,
  pages.meta_description,
  pages.created_at,
  pages.updated_at,
  media.path AS featured_image_path
`

const PAGE_JOINS = `
  FROM pages
  LEFT JOIN media ON media.id = pages.featured_image
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
      author?: string
      search?: string
      format?: ContentFormat
    } = {}
  ): Promise<{ posts: PublicPost[]; total: number }> {
    const db = await getDb()
    const { perPage = 10, offset = 0, category, tag, author, search, format = 'html' } = options

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

    if (author) {
      // An author archive: every post by one person. Slug or id, for the same
      // reason categories accept either — a consumer holding one should not
      // have to look up the other first.
      where.push('(users.slug = ? OR users.id = ?)')
      params.push(author, Number(author) || -1)
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
      `SELECT ${PAGE_COLUMNS} ${PAGE_JOINS}
       WHERE pages.published = 1
       ORDER BY pages.created_at DESC
       LIMIT ? OFFSET ?`,
      [perPage, offset]
    )) as PageRow[]

    return { pages: await shapePages(rows, format), total: Number(counted?.total) || 0 }
  },

  /** One published page, by slug or id. */
  async page(identifier: string, format: ContentFormat = 'html'): Promise<PublicPage | null> {
    const db = await getDb()

    const row = (await db.get(
      `SELECT ${PAGE_COLUMNS} ${PAGE_JOINS}
       WHERE pages.published = 1 AND (pages.slug = ? OR pages.id = ?)`,
      [identifier, Number(identifier) || -1]
    )) as PageRow | undefined

    return row ? (await shapePages([row], format))[0] : null
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

  /**
   * Every author with something published, newest names first by post count.
   *
   * Only people who have published: an account with no posts is a user, not an
   * author, and listing one exposes that the account exists to anyone who asks
   * for the author index. Counts come from the same `published = 1` filter the
   * post listing uses, so an archive link never leads to an empty page.
   */
  async authors(): Promise<PublicAuthor[]> {
    const db = await getDb()

    const rows = (await db.all(`
      SELECT users.id, users.name, users.slug, users.bio, users.website,
             avatars.path AS avatar_path,
             COUNT(posts.id) AS post_count
      FROM users
      JOIN posts ON posts.user_id = users.id AND posts.published = 1
      LEFT JOIN media AS avatars ON avatars.id = users.avatar_id
      GROUP BY users.id, users.name, users.slug, users.bio, users.website, avatars.path
      ORDER BY users.name ASC
    `)) as AuthorRow[]

    return shapeAuthors(rows)
  },

  /** One author, by slug or id. Null when they have published nothing. */
  async author(identifier: string): Promise<PublicAuthor | null> {
    const db = await getDb()

    const row = (await db.get(
      `SELECT users.id, users.name, users.slug, users.bio, users.website,
              avatars.path AS avatar_path,
              COUNT(posts.id) AS post_count
       FROM users
       JOIN posts ON posts.user_id = users.id AND posts.published = 1
       LEFT JOIN media AS avatars ON avatars.id = users.avatar_id
       WHERE users.slug = ? OR users.id = ?
       GROUP BY users.id, users.name, users.slug, users.bio, users.website, avatars.path`,
      [identifier, Number(identifier) || -1]
    )) as AuthorRow | undefined

    if (!row) return null

    return (await shapeAuthors([row]))[0]
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
  /** Absolute URL of the featured image, or null. */
  featured_image_url: string | null
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
 * An author, as a byline and an archive page need them.
 *
 * The address, the role and everything else on the account stay behind the
 * admin API. What is here is what a reader is meant to see.
 */
export interface PublicAuthor {
  /** Stable identifier. Accepted anywhere a slug is. */
  id: number
  /** Display name, as it appears on a byline. */
  name: string
  /** URL segment for the author's archive. Accepted by `?author=`. */
  slug: string | null
  /** The biography they wrote, if any. */
  bio: string | null
  /** Their own site, if they gave one. */
  website: string | null
  /** Absolute URL of their avatar, or null. */
  avatar_url: string | null
  /** How many published posts they have. Never zero — unpublished authors are not listed. */
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
  featured_image_path: string | null
  meta_title: string | null
  meta_description: string | null
  created_at: string
  updated_at: string
}

/** An author row as the archive queries return it: the profile, plus a count. */
interface AuthorRow {
  id: number
  name: string
  slug: string | null
  bio: string | null
  website: string | null
  avatar_path: string | null
  post_count: number | string
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

  const storage = rows.some((row) => row.featured_image_path || row.author_avatar_path)
    ? await getStorage()
    : null

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    ...contentFor(row.content, row.content_html, format),
    featured_image_url:
      row.featured_image_path && storage ? mediaUrl(storage, row.featured_image_path) : null,
    author: row.author_name,
    // `author` stays the display name it has always been — changing its type
    // would break every consumer reading a byline — and the profile arrives
    // beside it, so a static build can render a face and a biography without a
    // second request per post.
    author_profile: shapeAuthor(row, storage),
    categories: categoriesByPost.get(row.id) ?? [],
    tags: tagsByPost.get(row.id) ?? [],
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    published_at: row.created_at,
    updated_at: row.updated_at
  }))
}

/** Pages, with their featured image resolved in one adapter lookup per batch. */
async function shapePages(rows: PageRow[], format: ContentFormat): Promise<PublicPage[]> {
  const storage = rows.some((row) => row.featured_image_path) ? await getStorage() : null

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    ...contentFor(row.content, row.content_html, format),
    featured_image_url:
      row.featured_image_path && storage ? mediaUrl(storage, row.featured_image_path) : null,
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    published_at: row.created_at,
    updated_at: row.updated_at
  }))
}

/**
 * The author columns a post query joins, as one object.
 *
 * Returns null when the join produced no author at all, which the shape
 * documents: a post whose account was deleted still has words worth serving.
 */
function shapeAuthor(
  row: PostRow,
  storage: { publicUrl: (key: string) => string } | null
): PublicPost['author_profile'] {
  if (row.author_id === null || row.author_id === undefined) return null

  return {
    id: row.author_id,
    name: row.author_name ?? '',
    slug: row.author_slug,
    bio: row.author_bio,
    website: row.author_website,
    avatar_url:
      row.author_avatar_path && storage ? mediaUrl(storage, row.author_avatar_path) : null
  }
}

/** Author archive rows, with avatars resolved and counts made numbers. */
async function shapeAuthors(rows: AuthorRow[]): Promise<PublicAuthor[]> {
  const storage = rows.some((row) => row.avatar_path) ? await getStorage() : null

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    bio: row.bio,
    website: row.website,
    avatar_url: row.avatar_path && storage ? mediaUrl(storage, row.avatar_path) : null,
    // Postgres returns bigint counts as strings rather than lose precision.
    post_count: Number(row.post_count) || 0
  }))
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
