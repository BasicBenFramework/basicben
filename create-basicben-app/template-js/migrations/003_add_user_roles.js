/**
 * Add roles to users.
 *
 * New accounts default to the least privileged role; the first account keeps
 * full access.
 */

export const up = async (db) => {
  await db.exec(`
    ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'subscriber'
  `)

  await db.exec(`
    UPDATE users SET role = 'admin'
    WHERE id = (SELECT MIN(id) FROM users)
  `)
}

export const down = async (db) => {
  await db.exec('ALTER TABLE users DROP COLUMN role')
}
