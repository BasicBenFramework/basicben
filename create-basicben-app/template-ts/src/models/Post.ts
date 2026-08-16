import { getDb } from '@basicbenframework/core/db'
import { renderContent } from '@basicbenframework/core/content'
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
    return db.all(`
      SELECT posts.*, users.name as author_name
      FROM posts
      JOIN users ON posts.user_id = users.id
      WHERE posts.published = 1
      ORDER BY posts.created_at DESC
    `)
  },

  async findPublishedById(id: number): Promise<PostType | undefined> {
    const db = await getDb()
    return db.get(`
      SELECT posts.*, users.name as author_name
      FROM posts
      JOIN users ON posts.user_id = users.id
      WHERE posts.id = ? AND posts.published = 1
    `, [id])
  },

  async create(data: CreatePostData): Promise<PostType> {
    const db = await getDb()

    // Markdown is what the author wrote and what gets stored; the HTML beside
    // it is a cache, rebuilt here so reads never have to render.
    const contentHtml = await renderContent(data.content || '', {
      context: { table: 'posts', userId: data.user_id }
    })

    const result = await db.run(
      'INSERT INTO posts (user_id, title, content, content_html, published) VALUES (?, ?, ?, ?, ?)',
      [data.user_id, data.title, data.content, contentHtml, data.published ? 1 : 0]
    )

    const now = new Date().toISOString()
    return {
      id: result.lastInsertRowid as number,
      ...data,
      content_html: contentHtml,
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
