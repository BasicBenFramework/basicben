import { getDb, query } from '@basicbenframework/core/db'
import { DEFAULT_ROLE } from '@basicbenframework/core/auth/permissions'

// Columns update() is allowed to write. Without this, passing req.body straight
// through would let a caller set any column, including role.
const UPDATABLE = ['name', 'email', 'password', 'role', 'email_verified', 'email_verified_at']

export const User = {
  async all() {
    const db = await getDb()
    return db.all('SELECT * FROM users')
  },

  async find(id) {
    const db = await getDb()
    return db.get('SELECT * FROM users WHERE id = ?', [id])
  },

  async findByEmail(email) {
    const db = await getDb()
    return db.get('SELECT * FROM users WHERE email = ?', [email])
  },

  async count() {
    const db = await getDb()
    const row = await db.get('SELECT COUNT(*) as count FROM users')
    return Number(row?.count ?? 0)
  },

  async create(data) {
    const role = data.role ?? DEFAULT_ROLE
    // Goes through the query builder so Postgres gets a RETURNING clause and
    // the new id comes back — a raw INSERT yields a null id there.
    const users = await query('users')
    const result = await users.insert({ ...data, role })
    return { id: result.lastInsertRowid, ...data, role }
  },

  async update(id, data) {
    const db = await getDb()
    const entries = Object.entries(data).filter(([k]) => UPDATABLE.includes(k))

    if (entries.length === 0) {
      return this.find(id)
    }

    const fields = entries.map(([k]) => `${k} = ?`).join(', ')
    await db.run(
      `UPDATE users SET ${fields} WHERE id = ?`,
      [...entries.map(([, v]) => v), id]
    )
    return this.find(id)
  },

  async delete(id) {
    const db = await getDb()
    return db.run('DELETE FROM users WHERE id = ?', [id])
  }
}
