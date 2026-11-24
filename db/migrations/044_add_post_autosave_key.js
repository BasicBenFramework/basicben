/**
 * Makes the editor's first autosave of a new post idempotent.
 *
 * The editor turns a new post into a draft with one request
 * (`POST /api/posts/autosave`). If the row is written but the response is lost,
 * the editor cannot know, and its next try would make a second draft. It now
 * sends a key it generated once per screen; the server stores it here and
 * answers a repeat with the draft it already made. Unique per author, and
 * null on every post written any other way.
 */

export const up = async (db) => {
  await db.exec('ALTER TABLE posts ADD COLUMN autosave_key TEXT')
  await db.exec('CREATE UNIQUE INDEX idx_posts_autosave_key ON posts(user_id, autosave_key)')
}

export const down = async (db) => {
  await db.exec('DROP INDEX IF EXISTS idx_posts_autosave_key')
  await db.exec('ALTER TABLE posts DROP COLUMN autosave_key')
}
