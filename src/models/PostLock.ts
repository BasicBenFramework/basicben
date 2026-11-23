import { getDb } from '@basicbenframework/core/db'

/**
 * Soft edit locks on posts — who has a post open in the editor.
 *
 * Soft, as in WordPress: the lock does not stop anyone *reading* a post, and
 * anyone who may edit it may take the lock over. What it stops is the silent
 * overwrite — two people saving the same post, the second replacing the first
 * without either knowing the other was there. A save from someone who does not
 * hold a live lock gets a 409 naming who does.
 *
 * The editor holds the lock by heartbeat (every 30 seconds) and releases it on
 * leaving. A lock not refreshed for `LOCK_TTL_MS` is stale and free: a closed
 * laptop or a crashed tab must not hold a post hostage. Two minutes is four
 * missed heartbeats — enough to ride out a flaky connection, short enough that
 * the next person is not left waiting long.
 *
 * Locks are per account, not per tab: the same person in two tabs holds one
 * lock, as in WordPress. A post nobody holds is editable by anyone, so API
 * clients and scripts that never take a lock still work — they are only
 * refused while a person is actively in the editor.
 */

export const LOCK_TTL_MS = 2 * 60 * 1000

/** How often the editor should refresh, told to the client so the two agree. */
export const LOCK_HEARTBEAT_MS = 30 * 1000

export interface PostLockState {
  post_id: number
  user_id: number
  user_name: string | null
  locked_at: string
  expires_at: string
}

interface LockRow {
  post_id: number
  user_id: number
  user_name: string | null
  locked_at: string | Date
}

/**
 * A stored timestamp as milliseconds.
 *
 * Written as ISO strings here, but Postgres hands a TIMESTAMP column back as a
 * Date and SQLite's default format has a space and no zone — both are UTC.
 */
function millis(value: string | Date): number {
  if (value instanceof Date) return value.getTime()
  const bare = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
  return new Date(bare ? `${value.replace(' ', 'T')}Z` : value).getTime()
}

function shape(row: LockRow | undefined, now: number): PostLockState | null {
  if (!row) return null
  const at = millis(row.locked_at)
  if (!Number.isFinite(at) || now - at >= LOCK_TTL_MS) return null

  return {
    post_id: Number(row.post_id),
    user_id: Number(row.user_id),
    user_name: row.user_name ?? null,
    locked_at: new Date(at).toISOString(),
    expires_at: new Date(at + LOCK_TTL_MS).toISOString()
  }
}

export const PostLock = {
  /** The live lock on a post, or null when nobody holds one (or it went stale). */
  async current(postId: number, now = Date.now()): Promise<PostLockState | null> {
    const db = await getDb()
    const row = (await db.get(
      `SELECT post_locks.post_id, post_locks.user_id, post_locks.locked_at, users.name AS user_name
       FROM post_locks
       LEFT JOIN users ON users.id = post_locks.user_id
       WHERE post_locks.post_id = ?`,
      [postId]
    )) as LockRow | undefined

    return shape(row, now)
  },

  /**
   * Take or refresh the lock, if it is free, stale, or already ours.
   *
   * One conditional upsert, so two editors opening the same post at the same
   * moment cannot both come away holding it: the row is keyed on the post, and
   * the `WHERE` on the conflict branch only lets the update through for the
   * holder or over a stale lock. `takeOver` drops that condition — the person
   * has been shown who holds it and chosen to take it anyway.
   *
   * Works unchanged on SQLite (3.24+), libSQL and Postgres, which all speak
   * `ON CONFLICT … DO UPDATE … WHERE`.
   */
  async acquire(
    postId: number,
    userId: number,
    options: { takeOver?: boolean; now?: number } = {}
  ): Promise<{ acquired: boolean; lock: PostLockState | null }> {
    const now = options.now ?? Date.now()
    const stamp = new Date(now).toISOString()
    const staleBefore = new Date(now - LOCK_TTL_MS).toISOString()
    const db = await getDb()

    if (options.takeOver) {
      await db.run(
        `INSERT INTO post_locks (post_id, user_id, locked_at) VALUES (?, ?, ?)
         ON CONFLICT (post_id) DO UPDATE SET user_id = excluded.user_id, locked_at = excluded.locked_at`,
        [postId, userId, stamp]
      )
    } else {
      await db.run(
        `INSERT INTO post_locks (post_id, user_id, locked_at) VALUES (?, ?, ?)
         ON CONFLICT (post_id) DO UPDATE SET user_id = excluded.user_id, locked_at = excluded.locked_at
         WHERE post_locks.user_id = excluded.user_id OR post_locks.locked_at <= ?`,
        [postId, userId, stamp, staleBefore]
      )
    }

    // Read back rather than trusting the change count, which drivers report
    // differently for an upsert that took its conflict branch.
    const lock = await PostLock.current(postId, now)
    return { acquired: Boolean(lock && lock.user_id === userId), lock }
  },

  /**
   * Let go, if we hold it.
   *
   * Scoped to the holder so a tab closing after its lock was taken over does
   * not free the post from under the person who took it.
   */
  async release(postId: number, userId: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM post_locks WHERE post_id = ? AND user_id = ?', [postId, userId])
  },

  /**
   * The lock that stops `userId` saving, or null if nothing does.
   *
   * Nothing does when the post is unlocked, the lock went stale, or it is
   * this account's own.
   */
  async blocking(postId: number, userId: number, now = Date.now()): Promise<PostLockState | null> {
    const lock = await PostLock.current(postId, now)
    return lock && lock.user_id !== userId ? lock : null
  }
}
