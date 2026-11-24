import { can } from '@basicbenframework/core/auth/permissions'
import { Post } from '../models/Post.ts'
import { PostLock, LOCK_HEARTBEAT_MS, LOCK_TTL_MS, type PostLockState } from '../models/PostLock.ts'
import type { Post as PostType, Request, Response } from '../types/index.ts'

/**
 * The editor's lock on a post: take it, keep it, give it back.
 *
 * Session-only (see the routes): a lock is "a person has this open", which a
 * program does not. An API token never holds or takes over a lock; its writes
 * are refused while a person holds one — see `lockConflict` below.
 */
export const PostLockController = {
  /** Who, if anyone, is editing this post. */
  async show(req: Request, res: Response) {
    const post = await editable(req)
    if (!post) return res.json({ error: 'Post not found' }, 404)

    res.json({ lock: describe(await PostLock.current(post.id), req.userId!) })
  },

  /**
   * Acquire or refresh — the editor's heartbeat.
   *
   * `take_over: true` takes the lock from whoever holds it. Anyone who may
   * edit the post may do that, as in WordPress: the lock is a warning that
   * someone is there, not a permission. A 409 means the lock is held by
   * someone else and nothing changed; the body says who, so the editor can
   * offer the take-over.
   */
  async acquire(req: Request, res: Response) {
    const post = await editable(req)
    if (!post) return res.json({ error: 'Post not found' }, 404)

    const takeOver = (req.body as { take_over?: unknown } | undefined)?.take_over === true
    const { acquired, lock } = await PostLock.acquire(post.id, req.userId!, { takeOver })

    if (!acquired) {
      return res.json({ error: `${lock?.user_name || 'Someone else'} is editing this post.`, lock: describe(lock, req.userId!) }, 409)
    }

    res.json({ lock: describe(lock, req.userId!) })
  },

  /**
   * Let go, on leaving the editor.
   *
   * Sent with `fetch(..., { keepalive: true })` as the page unloads rather than
   * `navigator.sendBeacon`, because a beacon cannot carry the Authorization
   * header this API authenticates with. Always 200: there is nothing useful a
   * closing page could do with a failure, and a stale lock expires anyway.
   */
  async release(req: Request, res: Response) {
    const post = await editable(req)
    if (post) await PostLock.release(post.id, req.userId!)
    res.json({ released: true })
  }
}

/**
 * Why this write must not go ahead, or null if it may.
 *
 * Called by every PostController action that changes a post's text (update,
 * autosave, restoring a revision). A person holding a live lock on the post,
 * other than the caller, blocks it with a 409 naming them.
 *
 * - A signed-in caller may send `take_over: true` with the save to take the
 *   lock as part of it — the "save anyway" button.
 * - An API token cannot. A program overwriting what a person has open in
 *   front of them is the exact accident the lock exists to stop, and a script
 *   can retry after the lock lapses (two minutes after the editor closes)
 *   where a person cannot get their typing back.
 */
export async function lockConflict(
  req: Request,
  post: PostType
): Promise<{ error: string; lock: ReturnType<typeof describe> } | null> {
  const takeOver = !req.apiToken && (req.body as { take_over?: unknown } | undefined)?.take_over === true

  if (takeOver) {
    await PostLock.acquire(post.id, req.userId!, { takeOver: true })
    return null
  }

  const lock = await PostLock.blocking(post.id, req.userId!)
  if (!lock) return null

  return {
    error: `${lock.user_name || 'Someone else'} is editing this post. Your changes were not saved.`,
    lock: describe(lock, req.userId!)
  }
}

/** A lock as the client sees it — with "is it mine" worked out, and the timings. */
function describe(lock: PostLockState | null, userId: number) {
  return {
    locked: Boolean(lock),
    mine: Boolean(lock && lock.user_id === userId),
    user_id: lock?.user_id ?? null,
    user_name: lock?.user_name ?? null,
    locked_at: lock?.locked_at ?? null,
    expires_at: lock?.expires_at ?? null,
    heartbeat_ms: LOCK_HEARTBEAT_MS,
    ttl_ms: LOCK_TTL_MS
  }
}

/** The post, if this request may edit it — the same rule PostController uses. */
async function editable(req: Request): Promise<PostType | null> {
  const post = await Post.find(parseInt(req.params.id))
  if (!post || !can(req.user, 'post.edit', post)) return null
  return post
}
