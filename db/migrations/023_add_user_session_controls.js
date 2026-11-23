/**
 * Sessions that can be ended, and accounts that can be switched off.
 *
 * A session is a stateless JWT, so until now nothing could revoke one: signing
 * out discarded the token on one device and left every copy of it valid for
 * the rest of its seven days, and demoting an editor did nothing until their
 * token happened to expire.
 *
 * `token_version` is carried in every token and compared on every request.
 * Bumping it ends every session the account has, which is what signing out,
 * changing a password, and changing a role each need.
 *
 * `disabled_at` turns an account off without deleting it, so the posts it
 * wrote keep their author.
 */

export const up = async (db) => {
  await db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0')
  await db.exec('ALTER TABLE users ADD COLUMN disabled_at TEXT')
}

export const down = async (db) => {
  await db.exec('ALTER TABLE users DROP COLUMN disabled_at')
  await db.exec('ALTER TABLE users DROP COLUMN token_version')
}
