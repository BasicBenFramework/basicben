/**
 * Scheduling that schedules, review that can be asked for, and a trash.
 *
 * `publish_at` has existed since migration 009 and nothing read it: a post
 * given a future date went live the moment it was published. From here a post
 * is on the site when it is published, not in the trash, and its `publish_at`
 * has arrived — one rule, kept in `src/models/visibility.ts`, that every public
 * read goes through.
 *
 * `status` is the editorial state the admin shows: `draft`, `pending` (a
 * contributor asking for review) or `published`. `published` stays the flag
 * every query already filters on and is kept in step with it, so nothing that
 * reads the flag needs to learn the new column.
 *
 * `deleted_at` is the trash. A deleted post is hidden everywhere and can be
 * restored until it is emptied.
 *
 * `live_notified` records whether webhooks have been told a post is live. A
 * post published now is told at once; a scheduled one is told by the
 * publish-due tick when its time comes, which then sets this.
 */

export const up = async (db, grammar) => {
  await db.exec("ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'")
  await db.exec(`ALTER TABLE posts ADD COLUMN deleted_at ${grammar.timestampType()}`)
  await db.exec('ALTER TABLE posts ADD COLUMN live_notified INTEGER NOT NULL DEFAULT 1')

  await db.exec("UPDATE posts SET status = 'published' WHERE published = 1")

  // Everything already live stays live. A published post's publish_at was
  // ignored until now, so a future value there was never a schedule anyone
  // saw take effect; honouring it would make live posts vanish on deploy.
  await db.exec('UPDATE posts SET publish_at = created_at WHERE published = 1')

  await db.exec('CREATE INDEX idx_posts_status ON posts(status)')
  await db.exec('CREATE INDEX idx_posts_deleted_at ON posts(deleted_at)')
}

export const down = async (db) => {
  await db.exec('DROP INDEX IF EXISTS idx_posts_deleted_at')
  await db.exec('DROP INDEX IF EXISTS idx_posts_status')
  await db.exec('ALTER TABLE posts DROP COLUMN live_notified')
  await db.exec('ALTER TABLE posts DROP COLUMN deleted_at')
  await db.exec('ALTER TABLE posts DROP COLUMN status')
}
