/**
 * Edit locks: who has a post open in the editor right now.
 *
 * A soft lock in the WordPress sense. Two people editing the same post used to
 * mean the second save silently replaced the first; now the editor holds a
 * lock while it is open, refreshes it on a heartbeat, and anyone else who opens
 * the post is told who is in it and offered the chance to take over.
 *
 * A table of its own rather than two columns on `posts`:
 *
 * - A heartbeat every thirty seconds is a write, and on `posts` it would be a
 *   write to the row every public read and every listing reads, on a table
 *   other migrations keep altering. Here it is one narrow row.
 * - `SELECT posts.*` is how several reads build a post. Lock columns there
 *   would ride along into every one of them, the public feed included, and
 *   hand out which account is editing what.
 * - One row per post, keyed on the post, makes "take the lock if it is free
 *   or stale" a single conditional upsert rather than a read then a write.
 *
 * `locked_at` is the last heartbeat. A lock older than the expiry (two
 * minutes, in src/models/PostLock.ts) is free for the taking — a closed laptop
 * does not hold a post hostage. Expired rows are not cleaned up: there is at
 * most one per post, and the next person to open it overwrites it.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE post_locks (
      post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      locked_at ${grammar.timestampType()} NOT NULL
    )
  `)
}

export const down = async (db) => {
  await db.exec('DROP TABLE IF EXISTS post_locks')
}
