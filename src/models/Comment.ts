import { getDb, query } from '@basicbenframework/core/db'
import { MAX_DEPTH, type CommentStatus } from '../helpers/comment-guard'
import type { Comment as CommentType } from '../types'

interface CreateCommentData {
  post_id: number
  user_id?: number
  parent_id?: number
  author_name?: string
  author_email?: string
  content: string
  /** Kept for hook listeners written against the flag; `status` wins when both are given. */
  approved?: boolean
  status?: CommentStatus
  held_reason?: string | null
  author_ip?: string | null
  notify_replies?: boolean
}

interface UpdateCommentData {
  content?: string
}

export interface CommentCounts {
  /** Everything a moderator would call "the comments": pending and approved. */
  all: number
  pending: number
  approved: number
  spam: number
  trash: number
}

/**
 * The listing a moderator works from.
 *
 * Joined to the parent so a reply shows what it answers without a second
 * request per row, and to the post for its title. Moderators only — this
 * carries addresses and IPs.
 */
const MODERATION_COLUMNS = `
  c.*, u.name AS user_name, u.email AS user_email, p.title AS post_title,
  COALESCE(pu.name, pc.author_name) AS parent_author_name,
  pc.content AS parent_content
`
const MODERATION_JOINS = `
  FROM comments c
  LEFT JOIN users u ON u.id = c.user_id
  LEFT JOIN posts p ON p.id = c.post_id
  LEFT JOIN comments pc ON pc.id = c.parent_id
  LEFT JOIN users pu ON pu.id = pc.user_id
`

/** Placeholders for an IN list. Never interpolate the values themselves. */
const placeholders = (values: unknown[]) => values.map(() => '?').join(', ')

export const Comment = {
  async all(): Promise<CommentType[]> {
    const db = await getDb()
    return db.all(`SELECT ${MODERATION_COLUMNS} ${MODERATION_JOINS} ORDER BY c.created_at DESC`)
  },

  /**
   * One page of the moderation list, filtered by status.
   *
   * `all` is pending and approved together — what WordPress means by it —
   * because a list that mixes in spam buries the comments worth reading under
   * the ones that are not.
   */
  async list(options: { status: CommentStatus | 'all'; limit: number; offset: number }): Promise<{ comments: CommentType[]; total: number }> {
    const db = await getDb()
    const where = options.status === 'all' ? "c.status IN ('pending', 'approved')" : 'c.status = ?'
    const params = options.status === 'all' ? [] : [options.status]

    const comments = await db.all(`
      SELECT ${MODERATION_COLUMNS} ${MODERATION_JOINS}
      WHERE ${where}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, options.limit, options.offset])

    const row = await db.get(`SELECT COUNT(*) AS count FROM comments c WHERE ${where}`, params)
    return { comments, total: Number(row?.count ?? 0) }
  },

  /** How many comments sit in each tab. One query, grouped. */
  async counts(): Promise<CommentCounts> {
    const db = await getDb()
    const rows = await db.all('SELECT status, COUNT(*) AS count FROM comments GROUP BY status') as { status: string; count: unknown }[]
    const counts: CommentCounts = { all: 0, pending: 0, approved: 0, spam: 0, trash: 0 }
    for (const row of rows) {
      if (row.status in counts) counts[row.status as CommentStatus] = Number(row.count)
    }
    counts.all = counts.pending + counts.approved
    return counts
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

  /** A post's whole thread for a moderator, every status included. */
  async findByPostId(postId: number, approvedOnly = true): Promise<CommentType[]> {
    const db = await getDb()
    const approvedClause = approvedOnly ? "AND c.status = 'approved'" : ''

    const comments = await db.all(`
      SELECT c.*, u.name as user_name, u.email as user_email
      FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? ${approvedClause}
      ORDER BY c.created_at ASC
    `, [postId])

    return buildCommentTree(comments)
  },

  /**
   * The approved comments on a post, as a reader sees them.
   *
   * Explicit columns, never `c.*`: this answers anyone who asks, and the row
   * holds the guest's email address, the signed-in commenter's account
   * address and the commenter's IP beside the text. None is published.
   * `verified` says whether a comment came from an account, so a guest typing
   * an editor's name is not mistaken for the editor.
   *
   * Returned as a tree: top-level comments oldest first, each with its
   * `replies` oldest first, and a `depth` from 1. A reply whose parent is not
   * approved (since marked spam or trashed) is hidden with it, as WordPress
   * does: an answer to a comment nobody can see reads as a non sequitur.
   */
  async findPublicByPostId(postId: number): Promise<CommentType[]> {
    const db = await getDb()
    const comments = await db.all(`
      SELECT c.id, c.post_id, c.parent_id, c.content, c.created_at,
             COALESCE(u.name, c.author_name) AS author_name,
             CASE WHEN c.user_id IS NULL THEN 0 ELSE 1 END AS verified
      FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? AND c.status = 'approved'
      ORDER BY c.created_at ASC
    `, [postId])

    return buildCommentTree(comments)
  },

  async findPending(): Promise<CommentType[]> {
    const db = await getDb()
    return db.all(`
      SELECT ${MODERATION_COLUMNS} ${MODERATION_JOINS}
      WHERE c.status = 'pending'
      ORDER BY c.created_at DESC
    `)
  },

  /**
   * How deep a comment sits: 1 for a top-level comment.
   *
   * Walked rather than stored. The walk is bounded by MAX_DEPTH — past that
   * the answer is "too deep" whatever the exact number — and a stored depth
   * would have to be rewritten whenever a delete re-parents a reply.
   */
  async depthOf(comment: { parent_id?: number | null }): Promise<number> {
    let depth = 1
    let parentId = comment.parent_id == null ? null : Number(comment.parent_id)

    // The bound doubles as a guard against a parent cycle in hand-edited data.
    while (parentId !== null && depth <= MAX_DEPTH) {
      const parent = await this.find(parentId)
      if (!parent) break
      depth++
      parentId = parent.parent_id == null ? null : Number(parent.parent_id)
    }

    return depth
  },

  async create(data: CreateCommentData): Promise<CommentType> {
    const now = new Date().toISOString()
    const status: CommentStatus = data.status ?? (data.approved ? 'approved' : 'pending')

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
      status,
      approved: status === 'approved' ? 1 : 0,
      held_reason: data.held_reason || null,
      author_ip: data.author_ip || null,
      notify_replies: data.notify_replies ? 1 : 0,
      // Nothing to tell anyone about yet; set once the parent's author is told.
      reply_notified: 0,
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
      approved: status === 'approved',
      status,
      notify_replies: !!data.notify_replies,
      created_at: now
    }
  },

  async update(id: number, data: UpdateCommentData): Promise<CommentType> {
    const db = await getDb()
    // Only the text is editable here. Status goes through setStatus, which
    // keeps the old flag in step; a generic update could let them disagree.
    if (data.content !== undefined) {
      await db.run('UPDATE comments SET content = ? WHERE id = ?', [data.content, id])
    }
    return this.find(id) as Promise<CommentType>
  },

  /**
   * Move comments to a status, keeping `approved` in step with it.
   *
   * Returns the comments that actually changed — a moderator re-approving an
   * approved comment should not fire the approval hooks or the reply mail
   * a second time.
   */
  async setStatus(ids: number[], status: CommentStatus): Promise<CommentType[]> {
    if (!ids.length) return []
    const db = await getDb()

    const changing = await db.all(
      `SELECT * FROM comments WHERE id IN (${placeholders(ids)}) AND status <> ?`,
      [...ids, status]
    ) as CommentType[]
    if (!changing.length) return []

    const changingIds = changing.map(c => Number(c.id))
    // A moderator's decision replaces whatever a check said about it.
    await db.run(
      `UPDATE comments SET status = ?, approved = ?, held_reason = NULL WHERE id IN (${placeholders(changingIds)})`,
      [status, status === 'approved' ? 1 : 0, ...changingIds]
    )

    return changing.map(c => ({ ...c, status, approved: status === 'approved' }))
  },

  async approve(id: number): Promise<CommentType> {
    await this.setStatus([id], 'approved')
    return this.find(id) as Promise<CommentType>
  },

  async reject(id: number): Promise<void> {
    await this.delete(id)
  },

  /**
   * Delete a comment for good.
   *
   * Its replies move up to its own parent rather than going with it. They
   * used to be deleted too, which made removing one rude comment take every
   * answer to it — and with a spam folder to empty, the answers someone wrote
   * before the parent was marked would vanish without anyone choosing that.
   */
  async delete(id: number): Promise<void> {
    const db = await getDb()
    const comment = await this.find(id)
    if (!comment) return

    await db.run('UPDATE comments SET parent_id = ? WHERE parent_id = ?', [comment.parent_id ?? null, id])
    await db.run('DELETE FROM comments WHERE id = ?', [id])
  },

  /**
   * Empty the spam or the trash.
   *
   * Replies that are not themselves being emptied are lifted to the top level
   * first, for the reason given on `delete`; re-parenting each to its exact
   * grandparent would be a query per row, and a spam folder runs to
   * thousands. Returns how many were deleted.
   */
  async deleteByStatus(status: 'spam' | 'trash'): Promise<number> {
    const db = await getDb()
    await db.run(
      'UPDATE comments SET parent_id = NULL WHERE status <> ? AND parent_id IN (SELECT id FROM comments WHERE status = ?)',
      [status, status]
    )
    const result = await db.run('DELETE FROM comments WHERE status = ?', [status])
    return Number(result?.changes ?? 0)
  },

  async deleteByPostId(postId: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM comments WHERE post_id = ?', [postId])
  },

  /** Stop reply emails for one comment. True if there was such a comment. */
  async unsubscribe(id: number): Promise<boolean> {
    const db = await getDb()
    const result = await db.run('UPDATE comments SET notify_replies = 0 WHERE id = ?', [id])
    return Number(result?.changes ?? 0) > 0
  },

  /**
   * Claim the right to send a reply notification, once.
   *
   * A conditional UPDATE, so two moderators approving the same reply at the
   * same moment send one email between them, not two.
   */
  async claimReplyNotification(id: number): Promise<boolean> {
    const db = await getDb()
    const result = await db.run('UPDATE comments SET reply_notified = 1 WHERE id = ? AND reply_notified = 0', [id])
    return Number(result?.changes ?? 0) > 0
  },

  async count(postId: number, approvedOnly = true): Promise<number> {
    const db = await getDb()
    const approvedClause = approvedOnly ? "AND status = 'approved'" : ''
    const result = await db.get(
      `SELECT COUNT(*) as count FROM comments WHERE post_id = ? ${approvedClause}`,
      [postId]
    )
    return Number(result?.count ?? 0)
  },

  /** The moderation queue. Spam is not in it: nobody needs nagging about spam. */
  async countPending(): Promise<number> {
    const db = await getDb()
    const result = await db.get("SELECT COUNT(*) as count FROM comments WHERE status = 'pending'")
    return Number(result?.count ?? 0)
  }
}

function buildCommentTree(comments: CommentType[], parentId: number | null = null, depth = 1): CommentType[] {
  // Compared as numbers: Postgres and libSQL may hand ids back as strings or
  // bigints, and a strict comparison across types silently drops every reply.
  return comments
    .filter(comment => (comment.parent_id == null ? null : Number(comment.parent_id)) === parentId)
    .map(comment => ({
      ...comment,
      depth,
      replies: buildCommentTree(comments, Number(comment.id), depth + 1)
    }))
}
