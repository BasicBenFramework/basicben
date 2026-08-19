import { getDb, query } from '@basicbenframework/core/db'
import { DEFAULT_ROLE, capabilitiesFor } from '@basicbenframework/core/auth/permissions'
import { getStorage } from '@basicbenframework/core/storage'
import { uniqueSlug } from './derive'
import type { AuthorProfile, User as UserType } from '../types'

interface CreateUserData {
  name: string
  email: string
  password: string
  role?: string
  slug?: string
  // Set at registration: the first account is trusted, so a fresh install is
  // not locked out waiting for a mail that has nowhere to go.
  email_verified?: number
  email_verified_at?: string | null
}

interface UpdateUserData {
  name?: string
  email?: string
  password?: string
  role?: string
  slug?: string
  bio?: string | null
  website?: string | null
  avatar_id?: number | null
  email_verified?: number
  email_verified_at?: string | null
}

// Columns update() is allowed to write. Without this, passing req.body straight
// through would let a caller set any column, including role.
const UPDATABLE = [
  'name', 'email', 'password', 'role', 'email_verified', 'email_verified_at',
  // The author profile. `slug` is here because an author may want to choose
  // their own archive URL; update() re-uniquifies whatever arrives.
  'slug', 'bio', 'website', 'avatar_id'
]

/** The profile joined to its avatar. Every author read goes through this. */
const PROFILE_SELECT = `
  SELECT users.id, users.name, users.slug, users.bio, users.website,
         users.role, users.created_at, media.path AS avatar_path
  FROM users
  LEFT JOIN media ON media.id = users.avatar_id
`

/** A user row with the avatar key joined beside it. */
type ProfileRow = {
  id: number
  name: string
  slug: string | null
  bio: string | null
  website: string | null
  role: string
  created_at: string
  avatar_path: string | null
}

export const User = {
  async all(): Promise<UserType[]> {
    const db = await getDb()
    return db.all('SELECT * FROM users')
  },

  async find(id: number): Promise<UserType | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM users WHERE id = ?', [id])
  },

  async findByEmail(email: string): Promise<UserType | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM users WHERE email = ?', [email])
  },

  async count(): Promise<number> {
    const db = await getDb()
    const row = await db.get('SELECT COUNT(*) as count FROM users')
    return Number(row?.count ?? 0)
  },

  async create(data: CreateUserData): Promise<UserType> {
    const role = data.role ?? DEFAULT_ROLE

    // Every account is a potential author, so every account gets an archive
    // URL at registration rather than the first time someone edits a profile.
    // Two people with the same name get `jane-doe` and `jane-doe-2`.
    const slug = await uniqueSlug('users', data.slug || data.name, { fallback: 'author' })

    // Goes through the query builder so Postgres gets a RETURNING clause and
    // the new id comes back — a raw INSERT yields a null id there.
    const users = await query('users')
    const result = await users.insert({ ...data, role, slug })

    return {
      id: result.lastInsertRowid as number,
      ...data,
      role,
      slug,
      created_at: new Date().toISOString()
    }
  },

  async update(id: number, data: UpdateUserData): Promise<UserType> {
    const db = await getDb()

    // A chosen slug is still made unique. `users.slug` is uniquely indexed, so
    // the alternative to renaming a clash is a failed save halfway through
    // someone editing their profile.
    if (typeof data.slug === 'string') {
      data = { ...data, slug: await uniqueSlug('users', data.slug, { excludeId: id, fallback: 'author' }) }
    }

    const entries = Object.entries(data).filter(([k]) => UPDATABLE.includes(k))

    if (entries.length === 0) {
      return this.find(id) as Promise<UserType>
    }

    const fields = entries.map(([k]) => `${k} = ?`).join(', ')
    await db.run(
      `UPDATE users SET ${fields} WHERE id = ?`,
      [...entries.map(([, v]) => v), id]
    )
    return this.find(id) as Promise<UserType>
  },

  async delete(id: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM users WHERE id = ?', [id])
  },

  /**
   * One author profile, with the avatar resolved to a URL.
   *
   * Never returns the password or the address: this is the shape that ends up
   * on a byline, and a byline is public even when the page it sits on is not.
   */
  async profile(id: number): Promise<AuthorProfile | undefined> {
    const db = await getDb()
    const row = (await db.get(`${PROFILE_SELECT} WHERE users.id = ?`, [id])) as
      | ProfileRow
      | undefined

    return row ? (await withAvatars([row]))[0] : undefined
  },

  /** One author profile, by archive slug. */
  async profileBySlug(slug: string): Promise<AuthorProfile | undefined> {
    const db = await getDb()
    const row = (await db.get(`${PROFILE_SELECT} WHERE users.slug = ?`, [slug])) as
      | ProfileRow
      | undefined

    return row ? (await withAvatars([row]))[0] : undefined
  },

  /**
   * Everyone a post can be attributed to.
   *
   * Filtered by capability rather than by a list of role names, so a role added
   * to the framework appears here without this query being edited — and a
   * subscriber, who cannot write, never shows up in the editor's author menu.
   */
  async authors(): Promise<AuthorProfile[]> {
    const db = await getDb()
    const rows = (await db.all(`${PROFILE_SELECT} ORDER BY users.name ASC`)) as ProfileRow[]

    const canWrite = rows.filter((row) => {
      const held = capabilitiesFor(row.role)
      return held.includes('*') || held.includes('post.create')
    })

    return withAvatars(canWrite)
  }
}

/**
 * Resolve each avatar to a URL.
 *
 * `avatar_id` is a foreign key into `media`; the join supplies the storage key
 * and this turns it into something a browser can load. Resolved on read rather
 * than stored so that moving buckets does not mean rewriting every row — the
 * same reason posts resolve their featured image here rather than in the table.
 */
async function withAvatars(rows: ProfileRow[]): Promise<AuthorProfile[]> {
  const storage = rows.some((row) => row.avatar_path) ? await getStorage() : null

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    bio: row.bio,
    website: row.website,
    avatar_url: row.avatar_path && storage ? storage.publicUrl(row.avatar_path) : null
  }))
}
