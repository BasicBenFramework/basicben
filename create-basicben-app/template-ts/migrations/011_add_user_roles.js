/**
 * Add roles to users.
 *
 * Before this, every authenticated user could reach the whole admin area —
 * `auth: true` was the only gate. New accounts now default to the least
 * privileged role.
 */

export const up = async (db) => {
  await db.exec(`
    ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'subscriber'
  `)

  // The first account is whoever set the site up, so it keeps full access.
  await db.exec(`
    UPDATE users SET role = 'admin'
    WHERE id = (SELECT MIN(id) FROM users)
  `)
}

export const down = async (db) => {
  await db.exec('ALTER TABLE users DROP COLUMN role')
}
