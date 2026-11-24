/**
 * Newsletters: a post emailed to the members who asked for it.
 *
 * `newsletter_sends` is one row per post ever sent. `post_id` is UNIQUE, so a
 * post can be sent once — a second publish, a re-save, two overlapping ticks
 * all collide with the first row instead of mailing everyone again.
 *
 * - `status`: `preparing` (the row exists, recipients are being queued),
 *   `sending`, then `sent` once nothing is left in the queue.
 * - the counts are recomputed from the queue after each batch rather than
 *   incremented, so a batch that dies halfway cannot leave them wrong.
 *
 * `newsletter_queue` is one row per recipient. UNIQUE (send_id, member_id) is
 * the guarantee that a member is mailed a given post at most once: enqueueing
 * again inserts nothing, and a row is claimed by a conditional UPDATE before
 * its mail is sent, so two processors cannot both send it.
 *
 * - `status`: `pending`, `sending` (claimed), `sent`, `failed` (gave up after
 *   the maximum attempts, or was interrupted mid-send — see
 *   src/features/members/newsletter.ts for why an interrupted send is not retried) or
 *   `skipped` (the member unsubscribed or was deleted before their turn).
 * - `email` is the address at enqueue time, kept for the record; the mail goes
 *   to the member's current address.
 *
 * The processor runs in batches — a cron, an interval, an opportunistic tick —
 * because a serverless function cannot send ten thousand emails in one
 * invocation. Every batch picks up where the last one stopped.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE newsletter_sends (
      id ${grammar.autoIncrementPrimaryKey()},
      post_id INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'preparing',
      subject TEXT,
      total_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      started_at ${grammar.timestampType()},
      completed_at ${grammar.timestampType()}
    )
  `)

  await db.exec('CREATE INDEX idx_newsletter_sends_status ON newsletter_sends(status)')

  await db.exec(`
    CREATE TABLE newsletter_queue (
      id ${grammar.autoIncrementPrimaryKey()},
      send_id INTEGER NOT NULL REFERENCES newsletter_sends(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      claimed_at ${grammar.timestampType()},
      sent_at ${grammar.timestampType()},
      created_at ${grammar.timestampType()} DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (send_id, member_id)
    )
  `)

  // The processor's question is always "what is pending, oldest first".
  await db.exec('CREATE INDEX idx_newsletter_queue_status ON newsletter_queue(status, id)')
}

export const down = async (db, grammar) => {
  await db.exec(grammar.dropTable('newsletter_queue'))
  await db.exec(grammar.dropTable('newsletter_sends'))
}
