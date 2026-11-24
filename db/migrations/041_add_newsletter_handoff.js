/**
 * A newsletter handed to a provider instead of sent by the built-in queue.
 *
 * The members feature can give a post's send to whichever feature listens on
 * `newsletter.delivering` (src/features/members/newsletter.ts), such as the
 * mysendbox feature. The send row is still the one per post — its unique
 * `post_id` keeps "once per post" — and these say who took it:
 *
 * - `provider`: the feature that took the send, such as `mysendbox`.
 * - `external_id`: the provider's id for it, such as a broadcast id.
 * - `handoff_error`: why the last hand-off failed, shown on the health page.
 *
 * The statuses gain `handing_off` (claimed, the provider is being asked),
 * `handed_off` and `handoff_failed`. The built-in processor sends only rows in
 * `sending`, so a handed-off send is never also mailed by the queue.
 */

export const up = async (db) => {
  await db.exec('ALTER TABLE newsletter_sends ADD COLUMN provider TEXT')
  await db.exec('ALTER TABLE newsletter_sends ADD COLUMN external_id TEXT')
  await db.exec('ALTER TABLE newsletter_sends ADD COLUMN handoff_error TEXT')
}

export const down = async (db) => {
  await db.exec('ALTER TABLE newsletter_sends DROP COLUMN handoff_error')
  await db.exec('ALTER TABLE newsletter_sends DROP COLUMN external_id')
  await db.exec('ALTER TABLE newsletter_sends DROP COLUMN provider')
}
