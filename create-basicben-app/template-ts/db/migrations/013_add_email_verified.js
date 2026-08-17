/**
 * Mark whether a user has confirmed their email address.
 *
 * Existing rows are backfilled as verified. They predate the feature, and
 * retroactively locking out everyone who already had an account would be a
 * strange way to introduce it.
 */

export const up = async (db) => {
  await db.exec(`
    ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0
  `)
  await db.exec('ALTER TABLE users ADD COLUMN email_verified_at DATETIME')

  await db.exec(`
    UPDATE users
    SET email_verified = 1, email_verified_at = CURRENT_TIMESTAMP
  `)
}

export const down = async (db) => {
  await db.exec('ALTER TABLE users DROP COLUMN email_verified')
  await db.exec('ALTER TABLE users DROP COLUMN email_verified_at')
}
