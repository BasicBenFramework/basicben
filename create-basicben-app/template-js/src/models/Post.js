import { getDb } from '@basicbenframework/core/db'
import { renderContent } from '@basicbenframework/core/content'

export const Post = {
  async all() {
    const db = await getDb()
    return db.all('SELECT * FROM posts ORDER BY created_at DESC')
  },

  async find(id) {
    const db = await getDb()
    return db.get('SELECT * FROM posts WHERE id = ?', [id])
  },

  async findByUser(userId) {
    const db = await getDb()
    return db.all('SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC', [userId])
  },

  async findPublished() {
    const db = await getDb()
    return db.all(`
      SELECT posts.*, users.name as author_name
      FROM posts
      JOIN users ON posts.user_id = users.id
      WHERE posts.published = 1
      ORDER BY posts.created_at DESC
    `)
  },

  async findPublishedById(id) {
    const db = await getDb()
    return db.get(`
      SELECT posts.*, users.name as author_name
      FROM posts
      JOIN users ON posts.user_id = users.id
      WHERE posts.id = ? AND posts.published = 1
    `, [id])
  },

  async create(data) {
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

    return { id: result.lastInsertRowid, ...data, content_html: contentHtml }
  },

  async update(id, data) {
    const db = await getDb()

    const updateData = { ...data }

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

    return this.find(id)
  },

  async delete(id) {
    const db = await getDb()
    return db.run('DELETE FROM posts WHERE id = ?', [id])
  }
}
