import { getDb, query } from '@basicbenframework/core/db'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { renderContent } from '@basicbenframework/core/content'
import { getStorage } from '@basicbenframework/core/storage'
import type { Post as PostType } from '../types'

interface CreatePostData {
  user_id: number
  title: string
  content: string
  published: boolean
}

interface UpdatePostData {
  title?: string
  content?: string
  published?: number
}

export const Post = {
  async all(): Promise<PostType[]> {
    const db = await getDb()
    return db.all('SELECT * FROM posts ORDER BY created_at DESC')
  },

  async find(id: number): Promise<PostType | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM posts WHERE id = ?', [id])
  },

  async findByUser(userId: number): Promise<PostType[]> {
    const db = await getDb()
    return db.all('SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC', [userId])
  },

  async findPublished(): Promise<PostType[]> {
    const db = await getDb()
    const rows = await db.all(`
      SELECT posts.*, users.name as author_name, media.path as featured_image_path
      FROM posts
      JOIN users ON posts.user_id = users.id
      LEFT JOIN media ON media.id = posts.featured_image
      WHERE posts.published = 1
      ORDER BY posts.created_at DESC
    `)

    return withFeaturedImages(rows)
  },

  async findPublishedById(id: number): Promise<PostType | undefined> {
    const db = await getDb()
    const row = await db.get(`
      SELECT posts.*, users.name as author_name, media.path as featured_image_path
      FROM posts
      JOIN users ON posts.user_id = users.id
      LEFT JOIN media ON media.id = posts.featured_image
      WHERE posts.id = ? AND posts.published = 1
    `, [id])

    return row ? (await withFeaturedImages([row]))[0] : undefined
  },

  async create(data: CreatePostData): Promise<PostType> {
    const db = await getDb()

    // Markdown is what the author wrote and what gets stored; the HTML beside
    // it is a cache, rebuilt here so reads never have to render.
    const contentHtml = await renderContent(data.content || '', {
      context: { table: 'posts', userId: data.user_id }
    })

    // The last point a plugin can alter what is stored. Its return value has
    // to be what gets written, or the filter is decoration.
    const contentSaved = await hooks.filter(HOOKS.CONTENT_SAVE, contentHtml, { type: 'post', data })

    // Through the query builder, which appends RETURNING id on Postgres. A raw
    // INSERT there reports lastInsertRowid as null, so the row is written and
    // the caller is handed an object with no id — the failure looks like a bug
    // in whatever used the id next.
    const result = await (await query('posts')).insert({
      user_id: data.user_id,
      title: data.title,
      content: data.content,
      content_html: contentSaved,
      published: data.published ? 1 : 0
    })

    const now = new Date().toISOString()
    return {
      id: result.lastInsertRowid as number,
      ...data,
      content_html: contentSaved,
      published: data.published,
      created_at: now,
      updated_at: now
    }
  },

  async update(id: number, data: UpdatePostData): Promise<PostType> {
    const db = await getDb()

    const updateData: Record<string, unknown> = { ...data }

    // Re-render whenever the source changes, so the two can never disagree.
    if ('content' in data) {
      updateData.content_html = await renderContent(data.content || '', {
        context: { table: 'posts', id }
      })
    }

    const fields = Object.keys(updateData).map(k => `${k} = ?`).join(', ')
    await db.run(
      `UPDATE posts SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...Object.values(updateData), id]
    )

    return this.find(id) as Promise<PostType>
  },

  async delete(id: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM posts WHERE id = ?', [id])
  }
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
/** A post row as the join returns it: the post, plus the media key beside it. */
type PostRow = PostType & { featured_image_path?: string | null }

async function withFeaturedImages(rows: PostRow[]): Promise<PostType[]> {
  if (!rows.some((row) => row.featured_image_path)) return rows

  const storage = await getStorage()

  return rows.map((row) => ({
    ...row,
    featured_image_url: row.featured_image_path
      ? storage.publicUrl(row.featured_image_path)
      : null
  }))
}
