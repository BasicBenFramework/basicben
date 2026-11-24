/**
 * The mysendbox feature's record of each member's MySendbox contact, and of
 * each post's broadcast.
 *
 * One row per member the feature has had to do anything about. Sync is by
 * state, not by event: a member change marks the row `dirty`, and syncing
 * reads the member as it is now and makes MySendbox match. A missed or
 * repeated event therefore cannot leave the two apart for longer than the
 * next sync, and syncing twice does nothing the second time.
 *
 * `member_id` has no foreign key on purpose: when a member is deleted the row
 * stays, marked `erase`, until MySendbox has erased the contact too.
 *
 * - `email`: the address the contact was made for. A member who changes
 *   address gets a new contact, and the old one is unsubscribed.
 * - `contact_id`: MySendbox's `con_…` id, once known.
 * - `consent`: how this member agreed to newsletters, when the CMS saw them
 *   do it themselves (signing up, or ticking "send me posts" again). MySendbox
 *   keeps a consent record per contact and asks for this wording.
 * - `remote_status`, `remote_at`: the contact's status in MySendbox and when
 *   (ms) it was last heard, so an older webhook event can't undo a newer one.
 * - `state`: `dirty` (to sync), `synced`, `erase`, `needs_consent` (an added
 *   or imported member, with no attestation and no signup form to send them
 *   through) or `refused` (MySendbox said no, such as for someone who
 *   unsubscribed there; not retried until the member changes again).
 * - `attempts`, `last_error`: for retries and the health page.
 */

export const up = async (db, grammar) => {
  await db.exec(`
    CREATE TABLE mysendbox_contacts (
      member_id INTEGER PRIMARY KEY,
      email TEXT,
      contact_id TEXT,
      consent TEXT,
      remote_status TEXT,
      remote_at INTEGER,
      state TEXT NOT NULL DEFAULT 'dirty',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      synced_at ${grammar.timestampType()},
      updated_at ${grammar.timestampType()}
    )
  `)
  await db.exec('CREATE INDEX idx_mysendbox_contacts_state ON mysendbox_contacts(state)')
  await db.exec('CREATE INDEX idx_mysendbox_contacts_contact ON mysendbox_contacts(contact_id)')

  // A post's broadcast, recorded the moment MySendbox makes it, before it is
  // scheduled: a hand-off retried after a crash finds it here instead of
  // making a second broadcast (MySendbox's broadcasts take no idempotency key).
  await db.exec(`
    CREATE TABLE mysendbox_broadcasts (
      send_id INTEGER PRIMARY KEY,
      broadcast_id TEXT NOT NULL,
      created_at ${grammar.timestampType()}
    )
  `)
}

export const down = async (db) => {
  await db.exec('DROP TABLE mysendbox_broadcasts')
  await db.exec('DROP TABLE mysendbox_contacts')
}
