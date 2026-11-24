import { getDb, query } from '@basicbenframework/core/db'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { renderContent } from '@basicbenframework/core/content'
import { getStorage } from '@basicbenframework/core/storage'
import { derivedFields } from './derive.ts'
import type { Post as PostType } from '../types/index.ts'
import { livePost } from './visibility.ts'

interface CreatePostData {
  user_id: number
  title: string
  content: string
  published: boolean
  slug?: string
  excerpt?: string
  featured_image?: number | null
  meta_title?: string | null
  meta_description?: string | null
  publish_at?: string | null
  status?: 'draft' | 'pending' | 'published'
  live_notified?: number
  og_title?: string | null
  og_description?: string | null
  og_image?: number | null
  twitter_title?: string | null
  twitter_description?: string | null
  twitter_image?: number | null
  canonical_url?: string | null
  noindex?: number
  visibility?: string
  send_newsletter?: number
  is_private?: number
  /** Content type key (migration 038). Absent means `post`. */
  post_type?: string
  /** Custom field values as stored: a JSON string, already validated. */
  fields?: string | null
  /** The editor's idempotency key for a first autosave (migration 044). */
  autosave_key?: string
}

interface UpdatePostData {
  user_id?: number
  title?: string
  content?: string
  published?: number
  slug?: string
  excerpt?: string
  featured_image?: number | null
  meta_title?: string | null
  meta_description?: string | null
  publish_at?: string | null
  status?: 'draft' | 'pending' | 'published'
  deleted_at?: string | null
  live_notified?: number
  og_title?: string | null
  og_description?: string | null
  og_image?: number | null
  twitter_title?: string | null
  twitter_description?: string | null
  twitter_image?: number | null
  canonical_url?: string | null
  noindex?: number
  visibility?: string
  send_newsletter?: number
  is_private?: number
  post_type?: string
  fields?: string | null
}

/**
 * Columns `update()` will write, and nothing else.
 *
 * The old version built its SET clause from whatever keys it was handed, which
 * was safe only because the controller happened to pass three it had picked
 * itself. Anything that later passed a body straight through — a hook filter
 * returning the request, say — would have written any column named in it,
 * `user_id` and `created_at` included.
 */
const UPDATABLE = [
  'user_id', 'title', 'content', 'content_html', 'published', 'slug', 'excerpt',
  'featured_image', 'meta_title', 'meta_description', 'publish_at',
  'status', 'deleted_at', 'live_notified',
  'og_title', 'og_description', 'og_image', 'twitter_title', 'twitter_description',
  'twitter_image', 'canonical_url', 'noindex',
  'visibility', 'send_newsletter', 'is_private',
  // Content types (migrations 038–039). Validated by helpers/content-model.ts
  // before they reach here.
  'post_type', 'fields'
]

/** The social and indexing fields, written on create exactly as given. */
export const SEO_FIELDS = [
  'og_title', 'og_description', 'og_image', 'twitter_title', 'twitter_description',
  'twitter_image', 'canonical_url', 'noindex'
] as const

/**
 * The admin listing's filters, in the order the tabs show them.
 *
 * `scheduled` is not a stored status: it is a published post whose time has
 * not come, which is exactly how the public site decides not to show it.
 */
export const LISTING_FILTERS = ['all', 'draft', 'pending', 'scheduled', 'published', 'trash'] as const
export type ListingFilter = (typeof LISTING_FILTERS)[number]

function listingWhere(filter: ListingFilter, now: string): string {
  switch (filter) {
    case 'trash': return 'posts.deleted_at IS NOT NULL'
    case 'draft': return "posts.deleted_at IS NULL AND posts.status = 'draft'"
    case 'pending': return "posts.deleted_at IS NULL AND posts.status = 'pending'"
    case 'scheduled': return `posts.deleted_at IS NULL AND posts.published = 1 AND posts.publish_at > '${now}'`
    case 'published': return `posts.deleted_at IS NULL AND posts.published = 1 AND (posts.publish_at IS NULL OR posts.publish_at <= '${now}')`
    default: return 'posts.deleted_at IS NULL'
  }
}

export const Post = {
  async all(): Promise<PostType[]> {
    const db = await getDb()
    return db.all('SELECT * FROM posts ORDER BY created_at DESC')
  },

  /**
   * Replace a post's categories.
   *
   * Rebuilt rather than merged, because the editor sends the complete set: a
   * merge would make unchecking a box do nothing, which is the kind of bug
   * people re-report for months.
   *
   * `posts.category_id` is kept in step as the *primary* category — the first
   * of the set — so a breadcrumb or canonical URL still has one to name.
   */
  async syncCategories(postId: number, categoryIds: number[]): Promise<void> {
    const db = await getDb()
    const ids = [...new Set(categoryIds.map(Number).filter(Number.isInteger))]

    await db.run('DELETE FROM post_categories WHERE post_id = ?', [postId])

    for (const id of ids) {
      await db.run(
        'INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)',
        [postId, id]
      )
    }

    await db.run('UPDATE posts SET category_id = ? WHERE id = ?', [ids[0] ?? null, postId])
  },

  /** Replace a post's tags. Rebuilt, for the same reason as categories. */
  async syncTags(postId: number, tagIds: number[]): Promise<void> {
    const db = await getDb()
    const ids = [...new Set(tagIds.map(Number).filter(Number.isInteger))]

    await db.run('DELETE FROM post_tags WHERE post_id = ?', [postId])

    for (const id of ids) {
      await db.run('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)', [postId, id])
    }
  },

  /** The ids of a post's categories and tags, for the editor to preselect. */
  async taxonomy(postId: number): Promise<{ categories: number[]; tags: number[] }> {
    const db = await getDb()

    const categories = await db.all(
      'SELECT category_id AS id FROM post_categories WHERE post_id = ?',
      [postId]
    )
    const tags = await db.all('SELECT tag_id AS id FROM post_tags WHERE post_id = ?', [postId])

    return {
      categories: categories.map((row: { id: number }) => row.id),
      tags: tags.map((row: { id: number }) => row.id)
    }
  },

  async find(id: number): Promise<PostType | undefined> {
    const db = await getDb()

    // Joined rather than a bare `SELECT *` so the editor gets a URL for the
    // featured image instead of the media id it stores, and a name for the
    // author instead of a number — both of which it has to show.
    const row = await db.get(
      `SELECT posts.*, media.path AS featured_image_path, users.name AS author_name
       FROM posts
       LEFT JOIN media ON media.id = posts.featured_image
       LEFT JOIN users ON users.id = posts.user_id
       WHERE posts.id = ?`,
      [id]
    )

    return row ? (await withFeaturedImages([row]))[0] : undefined
  },

  async findByUser(userId: number): Promise<PostType[]> {
    const db = await getDb()
    return db.all('SELECT * FROM posts WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC', [userId])
  },

  /** How many posts sit in each listing tab, for the counts beside them. */
  async counts(userId?: number, type?: string): Promise<Record<ListingFilter, number>> {
    const db = await getDb()
    const now = new Date().toISOString()
    const result = {} as Record<ListingFilter, number>

    for (const filter of LISTING_FILTERS) {
      const where = [listingWhere(filter, now)]
      const params: unknown[] = []
      if (userId !== undefined) {
        where.push('posts.user_id = ?')
        params.push(userId)
      }
      if (type !== undefined) {
        where.push('posts.post_type = ?')
        params.push(type)
      }
      const row = await db.get(`SELECT COUNT(*) AS total FROM posts WHERE ${where.join(' AND ')}`, params)
      result[filter] = Number(row?.total) || 0
    }

    return result
  },

  /** Move to the trash. Hidden everywhere, restorable until emptied. */
  async trash(id: number): Promise<void> {
    const db = await getDb()
    await db.run('UPDATE posts SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), id])
  },

  /** Take out of the trash, in whatever state it was in before. */
  async restore(id: number): Promise<void> {
    const db = await getDb()
    await db.run('UPDATE posts SET deleted_at = NULL WHERE id = ?', [id])
  },

  /**
   * Scheduled posts whose time has come and that webhooks have not heard about.
   *
   * The public site needs nothing to make a scheduled post appear — the read
   * filter does that — but a webhook consumer has to be told, and nothing
   * happens at the moment the time passes. `publishDue()` asks this, tells
   * the consumers, then marks each one with `markNotified`.
   */
  async dueForNotification(): Promise<PostType[]> {
    const db = await getDb()
    return db.all(
      `SELECT * FROM posts WHERE live_notified = 0 AND ${livePost('posts')}`
    )
  },

  async markNotified(id: number): Promise<void> {
    const db = await getDb()
    await db.run('UPDATE posts SET live_notified = 1 WHERE id = ?', [id])
  },


  /**
   * One page of posts, with the total so a caller can size the pager.
   *
   * `userId` narrows it to one author's work. Omitting it returns everyone's,
   * which is what an editor or an admin should see — they can edit any post, so
   * a listing that showed only their own hid the site from the people
   * responsible for it.
   *
   * The count is a second query rather than a window function, because the
   * three drivers do not agree on those and this has to run on all of them.
   * It is cheap: an indexed count.
   */
  async paginate(
    { perPage, offset, userId, filter = 'all', search, type }: {
      perPage: number
      offset: number
      userId?: number
      filter?: ListingFilter
      search?: string
      /** One content type's entries; omitted lists every type. */
      type?: string
    }
  ): Promise<{ posts: PostType[]; total: number }> {
    const db = await getDb()

    // The trash is its own tab; everything else leaves it out. `now` is our
    // own ISO string, so inlining it is safe (see visibility.ts).
    const conditions = [listingWhere(filter, new Date().toISOString())]
    const scope: unknown[] = []

    if (userId !== undefined) {
      conditions.push('posts.user_id = ?')
      scope.push(userId)
    }

    if (type !== undefined) {
      conditions.push('posts.post_type = ?')
      scope.push(type)
    }

    if (search) {
      // Case-insensitive on every driver. LIKE is on SQLite and not on
      // Postgres, so both sides are lowered rather than trusting the default.
      // `%` and `_` in the search are literal characters, not wildcards.
      const needle = `%${search.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`
      conditions.push("(LOWER(posts.title) LIKE ? ESCAPE '\\' OR LOWER(posts.content) LIKE ? ESCAPE '\\')")
      scope.push(needle, needle)
    }

    const where = `WHERE ${conditions.join(' AND ')}`

    // `id` breaks ties. `created_at` alone is not a total order — these rows
    // are written in the same second all the time — and an unspecified order
    // is merely untidy until you paginate it, at which point LIMIT/OFFSET can
    // return a row on two pages and never return another. SQLite happens to be
    // stable here; Postgres is under no obligation to be.
    const posts = await db.all(
      `SELECT posts.*, users.name AS author_name
       FROM posts
       LEFT JOIN users ON users.id = posts.user_id
       ${where}
       ORDER BY posts.created_at DESC, posts.id DESC
       LIMIT ? OFFSET ?`,
      [...scope, perPage, offset]
    )

    const counted = await db.get(`SELECT COUNT(*) AS total FROM posts ${where}`, scope)

    // The listing showed a `category_name` this query never selected, so its
    // Category column rendered an em dash for every row whatever the post was
    // filed under. Categories are many-to-many now, so it could not have been a
    // single column anyway — they come back as an array, fetched once for the
    // page rather than once per row.
    return {
      posts: await withCategories(db, posts),
      total: Number(counted?.total) || 0
    }
  },

  async findPublished(): Promise<PostType[]> {
    const db = await getDb()
    const rows = await db.all(`
      SELECT ${PUBLISHED_COLUMNS} ${PUBLISHED_JOINS}
      WHERE ${livePost('posts')} AND posts.post_type = 'post'
      ORDER BY COALESCE(posts.publish_at, posts.created_at) DESC
    `)

    return withAuthors(await withFeaturedImages(rows))
  },

  async findPublishedById(id: number): Promise<PostType | undefined> {
    const db = await getDb()
    const row = await db.get(`
      SELECT ${PUBLISHED_COLUMNS} ${PUBLISHED_JOINS}
      WHERE posts.id = ? AND ${livePost('posts')}
    `, [id])

    if (!row) return undefined

    return (await withAuthors(await withFeaturedImages([row])))[0]
  },

  async create(data: CreatePostData): Promise<PostType> {
    const db = await getDb()

    // Markdown is what the author wrote and what gets stored; the HTML beside
    // it is a cache, rebuilt here so reads never have to render.
    const contentHtml = await renderContent(data.content || '', {
      context: { table: 'posts', userId: data.user_id }
    })

    // The last point a listener can alter what is stored. Its return value has
    // to be what gets written, or the filter is decoration.
    const contentSaved = await hooks.filter(HOOKS.CONTENT_SAVE, contentHtml, { type: 'post', data })

    // A slug and an excerpt the author did not type. Both were columns the
    // editor showed and nothing ever wrote: every post this CMS created had a
    // null slug, so its only URL was an id.
    const derived = await derivedFields('posts', data)

    // Through the query builder, which appends RETURNING id on Postgres. A raw
    // INSERT there reports lastInsertRowid as null, so the row is written and
    // the caller is handed an object with no id — the failure looks like a bug
    // in whatever used the id next.
    const result = await (await query('posts')).insert({
      user_id: data.user_id,
      title: data.title,
      content: data.content,
      content_html: contentSaved,
      slug: derived.slug,
      excerpt: derived.excerpt,
      featured_image: data.featured_image ?? null,
      meta_title: data.meta_title ?? null,
      meta_description: data.meta_description ?? null,
      publish_at: data.publish_at ?? null,
      published: data.published ? 1 : 0,
      status: data.status ?? (data.published ? 'published' : 'draft'),
      live_notified: data.live_notified ?? 1,
      visibility: data.visibility ?? 'public',
      send_newsletter: data.send_newsletter ?? 0,
      is_private: data.is_private ? 1 : 0,
      post_type: data.post_type ?? 'post',
      fields: data.fields ?? null,
      ...(data.autosave_key ? { autosave_key: data.autosave_key } : {}),
      ...Object.fromEntries(SEO_FIELDS.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]))
    })

    const now = new Date().toISOString()
    return {
      id: result.lastInsertRowid as number,
      ...data,
      ...derived,
      content_html: contentSaved,
      published: data.published,
      created_at: now,
      updated_at: now
    }
  },

  async update(id: number, data: UpdatePostData): Promise<PostType> {
    const db = await getDb()
    const existing = await this.find(id)

    const updateData: Record<string, unknown> = { ...data }

    // Re-render whenever the source changes, so the two can never disagree.
    if ('content' in data) {
      updateData.content_html = await renderContent(data.content || '', {
        context: { table: 'posts', id }
      })
    }

    // Blank means "derive it", the same as on create — except that a post which
    // already has a slug keeps it, so retitling does not move a published URL.
    if ('slug' in data || 'excerpt' in data || 'title' in data || 'content' in data) {
      const derived = await derivedFields(
        'posts',
        {
          title: data.title ?? existing?.title,
          content: data.content ?? existing?.content,
          slug: data.slug,
          excerpt: data.excerpt
        },
        { excludeId: id, existingSlug: existing?.slug, existingExcerpt: existing?.excerpt }
      )

      updateData.slug = derived.slug
      updateData.excerpt = derived.excerpt
    }

    // `undefined` means the caller said nothing about that column. Writing it
    // would bind undefined into the statement, which is either an error or a
    // null depending on the driver — both of them wrong.
    const writable = Object.entries(updateData).filter(
      ([key, value]) => UPDATABLE.includes(key) && value !== undefined
    )

    if (writable.length === 0) return this.find(id) as Promise<PostType>

    const fields = writable.map(([key]) => `${key} = ?`).join(', ')
    await db.run(
      `UPDATE posts SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...writable.map(([, value]) => value), id]
    )

    return this.find(id) as Promise<PostType>
  },

  /**
   * Forget a draft's slug, so the first real save derives one.
   *
   * For the draft an autosave makes from a new post's first words (see
   * `PostController.autosaveNew`): a slug derived then would come from "He",
   * or be `post` for a draft with only a body, and the editor would load it
   * back as if the author had chosen it. Null is what a post with no slug yet
   * already means, and the unique index allows any number of them.
   */
  /** The draft a first autosave with this key already made, if any (migration 044). */
  async findByAutosaveKey(userId: number, key: string): Promise<PostType | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM posts WHERE user_id = ? AND autosave_key = ?', [userId, key])
  },

  async forgetSlug(id: number): Promise<void> {
    const db = await getDb()
    await db.run('UPDATE posts SET slug = NULL WHERE id = ?', [id])
  },

  /** Gone for good. Only ever called on a post already in the trash. */
  async delete(id: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM post_revisions WHERE post_id = ?', [id])
    await db.run('DELETE FROM posts WHERE id = ?', [id])
  }
}

/**
 * What the feed selects, named once so the list and the single-item query
 * cannot drift apart.
 *
 * The author's profile travels with the post because a byline is more than a
 * name now — a face and a line of biography are what make a multi-author blog
 * read like one. `avatar_path` is a storage key; `withAuthors` turns it into
 * something a browser can load.
 */
const PUBLISHED_COLUMNS = `
  posts.*,
  users.name AS author_name,
  users.slug AS author_slug,
  users.bio AS author_bio,
  users.website AS author_website,
  avatars.path AS author_avatar_path,
  media.path AS featured_image_path
`

const PUBLISHED_JOINS = `
  FROM posts
  JOIN users ON posts.user_id = users.id
  LEFT JOIN media ON media.id = posts.featured_image
  LEFT JOIN media AS avatars ON avatars.id = users.avatar_id
`

/** A post row as the join returns it: the post, plus the media key beside it. */
type PostRow = PostType & {
  featured_image_path?: string | null
  author_slug?: string | null
  author_bio?: string | null
  author_website?: string | null
  author_avatar_path?: string | null
}

/**
 * Resolve each post's featured image to a URL.
 *
 * `featured_image` is a foreign key into `media`, but the front end renders it as
 * a filename — producing `/uploads/3` for every post that had one. The join
 * supplies the storage key and this turns it into a URL, which is the only
 * thing a browser can use.
 *
 * The key is resolved here rather than stored as a URL so that moving buckets,
 * or putting a CDN in front of one, does not mean rewriting every row.
 */
async function withFeaturedImages(rows: PostRow[]): Promise<PostRow[]> {
  if (!rows.some((row) => row.featured_image_path)) return rows

  const storage = await getStorage()

  return rows.map((row) => ({
    ...row,
    featured_image_url: row.featured_image_path
      ? storage.publicUrl(row.featured_image_path)
      : null
  }))
}

/**
 * Fold the joined author columns into one profile object.
 *
 * `author_name` stays where it is: every byline already reads it, and moving it
 * would be a change to a shape the front end has always had for the sake of
 * tidiness. The profile is added beside it.
 *
 * The avatar URL is resolved from the same storage adapter as a featured image,
 * so the two cannot disagree about where files live.
 */
async function withAuthors(rows: PostRow[]): Promise<PostType[]> {
  const storage = rows.some((row) => row.author_avatar_path) ? await getStorage() : null

  return rows.map((row) => ({
    ...row,
    author: {
      id: row.user_id,
      name: row.author_name ?? '',
      slug: row.author_slug ?? null,
      bio: row.author_bio ?? null,
      website: row.author_website ?? null,
      avatar_url:
        row.author_avatar_path && storage ? storage.publicUrl(row.author_avatar_path) : null
    }
  }))
}

/**
 * Attach each post's categories, in one query for the whole page.
 *
 * One query per post would be invisible on a seeded database and painful on a
 * real one — the same reason PublicContent batches its tags.
 */
type CategoryRef = { id: number; name: string; slug: string }

async function withCategories(
  db: { all: (sql: string, params?: unknown[]) => Promise<unknown[]> },
  posts: PostType[]
): Promise<Array<PostType & { categories: CategoryRef[] }>> {
  if (posts.length === 0) return []

  const ids = posts.map((post) => post.id)
  const placeholders = ids.map(() => '?').join(', ')

  const rows = (await db.all(
    `SELECT pc.post_id, c.id, c.name, c.slug
     FROM post_categories pc
     JOIN categories c ON c.id = pc.category_id
     WHERE pc.post_id IN (${placeholders})
     ORDER BY c.name ASC`,
    ids
  )) as Array<{ post_id: number } & CategoryRef>

  const byPost = new Map<number, CategoryRef[]>()

  for (const row of rows) {
    const list = byPost.get(row.post_id) ?? []
    list.push({ id: row.id, name: row.name, slug: row.slug })
    byPost.set(row.post_id, list)
  }

  return posts.map((post) => ({ ...post, categories: byPost.get(post.id) ?? [] }))
}
