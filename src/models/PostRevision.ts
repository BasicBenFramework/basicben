import { getDb, query } from '@basicbenframework/core/db'
import { parseStoredTimestamp } from './visibility.ts'

export interface PostRevision {
  id: number
  post_id: number
  user_id: number | null
  author_name?: string | null
  title: string
  content: string
  excerpt: string | null
  autosave: number
  created_at: string
}

/** How many saved revisions a post keeps. The oldest beyond this are pruned. */
const KEEP = 50

/**
 * Revisions of a post.
 *
 * A revision is a copy of the post *before* a save changed it, so the newest
 * revision plus the post itself is the whole history. Autosaves live in the
 * same table, flagged, one per post and author: replaced on every autosave
 * and cleared when the author saves for real.
 */
export const PostRevision = {
  /** Record what a post said before a save, if the save changes it. */
  async snapshot(
    before: { id: number; title: string; content: string; excerpt?: string | null },
    after: { title?: string; content?: string; excerpt?: string | null },
    userId: number | null
  ): Promise<void> {
    const changed =
      (after.title !== undefined && after.title !== before.title) ||
      (after.content !== undefined && after.content !== before.content) ||
      (after.excerpt !== undefined && (after.excerpt ?? null) !== (before.excerpt ?? null))

    if (!changed) return

    await (await query('post_revisions')).insert({
      post_id: before.id,
      user_id: userId,
      title: before.title,
      content: before.content,
      excerpt: before.excerpt ?? null,
      autosave: 0,
      created_at: new Date().toISOString()
    })

    await this.prune(before.id)
  },

  async list(postId: number): Promise<PostRevision[]> {
    const db = await getDb()
    return db.all(
      `SELECT r.id, r.post_id, r.user_id, r.title, r.excerpt, r.autosave, r.created_at,
              u.name AS author_name
       FROM post_revisions r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.post_id = ?
       ORDER BY r.created_at DESC, r.id DESC`,
      [postId]
    )
  },

  async find(postId: number, id: number): Promise<PostRevision | undefined> {
    const db = await getDb()
    return db.get(
      `SELECT r.*, u.name AS author_name FROM post_revisions r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.post_id = ? AND r.id = ?`,
      [postId, id]
    )
  },

  /** Replace this author's autosave of this post. */
  async autosave(
    postId: number,
    userId: number,
    data: { title: string; content: string; excerpt?: string | null }
  ): Promise<PostRevision | undefined> {
    const db = await getDb()
    await db.run('DELETE FROM post_revisions WHERE post_id = ? AND user_id = ? AND autosave = 1', [postId, userId])
    const result = await (await query('post_revisions')).insert({
      post_id: postId,
      user_id: userId,
      title: data.title,
      content: data.content,
      excerpt: data.excerpt ?? null,
      autosave: 1,
      created_at: new Date().toISOString()
    })
    return this.find(postId, Number(result.lastInsertRowid))
  },

  /** An author's pending autosave of a post, if it is newer than the post. */
  async pendingAutosave(postId: number, userId: number, postUpdatedAt: string): Promise<PostRevision | undefined> {
    const db = await getDb()
    const row = (await db.get(
      'SELECT * FROM post_revisions WHERE post_id = ? AND user_id = ? AND autosave = 1',
      [postId, userId]
    )) as PostRevision | undefined
    if (!row) return undefined
    return parseStoredTimestamp(row.created_at) > parseStoredTimestamp(postUpdatedAt) ? row : undefined
  },

  async clearAutosave(postId: number, userId: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM post_revisions WHERE post_id = ? AND user_id = ? AND autosave = 1', [postId, userId])
  },

  /** Keep the newest KEEP saved revisions; autosaves are not counted. */
  async prune(postId: number): Promise<void> {
    const db = await getDb()
    const rows = (await db.all(
      'SELECT id FROM post_revisions WHERE post_id = ? AND autosave = 0 ORDER BY created_at DESC, id DESC',
      [postId]
    )) as Array<{ id: number }>
    for (const row of rows.slice(KEEP)) {
      await db.run('DELETE FROM post_revisions WHERE id = ?', [row.id])
    }
  }
}
