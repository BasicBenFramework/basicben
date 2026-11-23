/**
 * Comment moderation that can say "spam", and replies people can follow.
 *
 * `status` is the moderation state: `pending`, `approved`, `spam` or `trash`.
 * One flag could only say approved or not, so spam sat in the same queue as
 * the comments worth reading and deleting was the only way to clear it. The
 * `approved` flag stays and is kept in step with it (`approved = 1` exactly
 * when `status = 'approved'`), so anything already reading the flag still
 * reads the truth — the same arrangement as posts' `published` and `status`.
 *
 * `held_reason` records why a check held a comment or called it spam
 * ("honeypot", "links: 5"), so a moderator can tell a false positive from a
 * bot at a glance, and tune the blocklist that caused it.
 *
 * `author_ip` is the commenter's address as the rate limiter sees it — IPv4,
 * or an IPv6 /64 — for blocklisting a persistent spammer. Moderators only; it
 * is never part of a public read.
 *
 * `notify_replies` is the commenter's opt-in to an email when someone replies.
 * Off for every existing comment: nobody agreed to mail they never asked for.
 *
 * `reply_notified` is set on a reply once its parent's author has been told
 * about it, so approving, unapproving and approving again sends one email.
 */

export const up = async (db) => {
  await db.exec("ALTER TABLE comments ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'")
  await db.exec('ALTER TABLE comments ADD COLUMN held_reason TEXT')
  await db.exec('ALTER TABLE comments ADD COLUMN author_ip TEXT')
  await db.exec('ALTER TABLE comments ADD COLUMN notify_replies INTEGER NOT NULL DEFAULT 0')
  await db.exec('ALTER TABLE comments ADD COLUMN reply_notified INTEGER NOT NULL DEFAULT 0')

  // Every approved comment stays approved; everything else was waiting for a
  // moderator, which is what `pending` means.
  await db.exec("UPDATE comments SET status = 'approved' WHERE approved = 1")

  // Existing replies predate opt-in, so there is nobody to tell about them;
  // marking them told keeps a later re-approval from mailing anyone.
  await db.exec('UPDATE comments SET reply_notified = 1 WHERE parent_id IS NOT NULL')

  await db.exec('CREATE INDEX idx_comments_status ON comments(status)')
  await db.exec('CREATE INDEX idx_comments_post_status ON comments(post_id, status)')
}

export const down = async (db) => {
  await db.exec('DROP INDEX IF EXISTS idx_comments_post_status')
  await db.exec('DROP INDEX IF EXISTS idx_comments_status')
  await db.exec('ALTER TABLE comments DROP COLUMN reply_notified')
  await db.exec('ALTER TABLE comments DROP COLUMN notify_replies')
  await db.exec('ALTER TABLE comments DROP COLUMN author_ip')
  await db.exec('ALTER TABLE comments DROP COLUMN held_reason')
  await db.exec('ALTER TABLE comments DROP COLUMN status')
}
