import { getDb, query } from '@basicbenframework/core/db'
import type { Comment as CommentType } from '../types'

interface CreateCommentData {
  post_id: number
  user_id?: number
  parent_id?: number
  author_name?: string
  author_email?: string
  content: string
  approved?: boolean
}

interface UpdateCommentData {
  content?: string
  approved?: boolean
}

export const Comment = {
  async all(): Promise<CommentType[]> {
    const db = await getDb()
    return db.all(`
      SELECT c.*, u.name as user_name, u.email as user_email, p.title as post_title
      FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
      LEFT JOIN posts p ON p.id = c.post_id
      ORDER BY c.created_at DESC
    `)
  },

  async find(id: number): Promise<CommentType | undefined> {
    const db = await getDb()
    return db.get(`
      SELECT c.*, u.name as user_name, u.email as user_email
      FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id = ?
    `, [id])
  },

  async findByPostId(postId: number, approvedOnly = true): Promise<CommentType[]> {
    const db = await getDb()
    const approvedClause = approvedOnly ? 'AND c.approved = 1' : ''

    const comments = await db.all(`
      SELECT c.*, u.name as user_name, u.email as user_email
      FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? ${approvedClause}
      ORDER BY c.created_at ASC
    `, [postId])

    return buildCommentTree(comments)
  },

  async findPending(): Promise<CommentType[]> {
    const db = await getDb()
    return db.all(`
      SELECT c.*, u.name as user_name, p.title as post_title
      FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
      LEFT JOIN posts p ON p.id = c.post_id
      WHERE c.approved = 0
      ORDER BY c.created_at DESC
    `)
  },

  async create(data: CreateCommentData): Promise<CommentType> {
    const db = await getDb()
    const now = new Date().toISOString()

    // Through the query builder, which appends RETURNING id on Postgres. A raw
    // INSERT there reports lastInsertRowid as null, so the row is written and
    // the caller is handed an object with no id.
    const result = await (await query('comments')).insert({
      post_id: data.post_id,
      user_id: data.user_id || null,
      parent_id: data.parent_id || null,
      author_name: data.author_name || null,
      author_email: data.author_email || null,
      content: data.content,
      approved: data.approved ? 1 : 0,
      created_at: now
    })

    return {
      id: result.lastInsertRowid as number,
      post_id: data.post_id,
      user_id: data.user_id,
      parent_id: data.parent_id,
      author_name: data.author_name,
      author_email: data.author_email,
      content: data.content,
      approved: data.approved || false,
      created_at: now
    }
  },

  async update(id: number, data: UpdateCommentData): Promise<CommentType> {
    const db = await getDb()

    const updateData: Record<string, unknown> = { ...data }
    if ('approved' in data) {
      updateData.approved = data.approved ? 1 : 0
    }

    const fields = Object.keys(updateData).map(k => `${k} = ?`).join(', ')
    await db.run(
      `UPDATE comments SET ${fields} WHERE id = ?`,
      [...Object.values(updateData), id]
    )

    return this.find(id) as Promise<CommentType>
  },

  async approve(id: number): Promise<CommentType> {
    return this.update(id, { approved: true })
  },

  async reject(id: number): Promise<void> {
    await this.delete(id)
  },

  async delete(id: number): Promise<void> {
    const db = await getDb()
    // Delete replies first (CASCADE should handle this, but being explicit)
    await db.run('DELETE FROM comments WHERE parent_id = ?', [id])
    // Delete comment
    await db.run('DELETE FROM comments WHERE id = ?', [id])
  },

  async deleteByPostId(postId: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM comments WHERE post_id = ?', [postId])
  },

  async count(postId: number, approvedOnly = true): Promise<number> {
    const db = await getDb()
    const approvedClause = approvedOnly ? 'AND approved = 1' : ''
    const result = await db.get(
      `SELECT COUNT(*) as count FROM comments WHERE post_id = ? ${approvedClause}`,
      [postId]
    )
    return result?.count || 0
  },

  async countPending(): Promise<number> {
    const db = await getDb()
    const result = await db.get('SELECT COUNT(*) as count FROM comments WHERE approved = 0')
    return result?.count || 0
  }
}

function buildCommentTree(comments: CommentType[], parentId: number | null = null): CommentType[] {
  return comments
    .filter(comment => comment.parent_id === parentId)
    .map(comment => ({
      ...comment,
      replies: buildCommentTree(comments, comment.id)
    }))
}
