/**
 * Members: readers with an email address and, optionally, a newsletter
 * subscription. See migration 033 for why they are not `users`.
 *
 * Imported (indirectly) by middleware, which the framework loads through
 * Node's own `import()` — so relative imports here carry their extension.
 */

import { getDb, query } from '@basicbenframework/core/db'
import { normalizeEmail } from './session.ts'
import { parseStoredTimestamp } from '../../models/visibility.ts'

export type MemberStatus = 'active' | 'unsubscribed'
export const MEMBER_STATUSES: MemberStatus[] = ['active', 'unsubscribed']
export type MemberSource = 'signup' | 'admin' | 'import'

export interface MemberRow {
  id: number
  email: string
  name: string | null
  status: MemberStatus
  note: string | null
  labels: string | null
  source: MemberSource
  session_version: number
  email_verified_at: string | null
  unsubscribed_at: string | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

/** What a member is shown about themselves. No session counter, no admin note. */
export interface MemberProfile {
  id: number
  email: string
  name: string | null
  /** Whether newsletters are mailed to them. */
  newsletter: boolean
  email_verified: boolean
  created_at: string
}

export function memberProfile(row: MemberRow): MemberProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    newsletter: row.status === 'active',
    email_verified: Boolean(row.email_verified_at),
    created_at: row.created_at
  }
}

/** Labels as stored: trimmed, de-duplicated, comma separated, or null. */
export function normalizeLabels(value: unknown): string | null {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',')
  const labels = [...new Set(list.map(label => String(label).trim()).filter(Boolean).map(label => label.slice(0, 50)))]
  return labels.length ? labels.slice(0, 20).join(', ') : null
}

/** A cheap shape check. Real proof of an address is the magic link. */
export function looksLikeEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(value)
}

export const Member = {
  async find(id: number): Promise<MemberRow | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM members WHERE id = ?', [id])
  },

  async findByEmail(email: string): Promise<MemberRow | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM members WHERE email = ?', [normalizeEmail(email)])
  },

  async create(data: {
    email: string
    name?: string | null
    status?: MemberStatus
    note?: string | null
    labels?: string | null
    source?: MemberSource
    email_verified_at?: string | null
  }): Promise<MemberRow> {
    const now = new Date().toISOString()
    const status = data.status ?? 'active'

    // Through the query builder for RETURNING id on Postgres — see Post.create.
    const result = await (await query('members')).insert({
      email: normalizeEmail(data.email),
      name: data.name ?? null,
      status,
      note: data.note ?? null,
      labels: data.labels ?? null,
      source: data.source ?? 'signup',
      session_version: 0,
      email_verified_at: data.email_verified_at ?? null,
      unsubscribed_at: status === 'unsubscribed' ? now : null,
      created_at: now,
      updated_at: now
    })

    return (await this.find(Number(result.lastInsertRowid)))!
  },

  /** Write the fields a member or an admin may change. Absent keys are left alone. */
  async update(id: number, changes: { name?: string | null; status?: MemberStatus; note?: string | null; labels?: string | null; email?: string }): Promise<MemberRow | undefined> {
    const db = await getDb()
    const existing = await this.find(id)
    if (!existing) return undefined

    const sets: string[] = []
    const params: unknown[] = []
    const now = new Date().toISOString()

    if (changes.name !== undefined) { sets.push('name = ?'); params.push(changes.name) }
    if (changes.note !== undefined) { sets.push('note = ?'); params.push(changes.note) }
    if (changes.labels !== undefined) { sets.push('labels = ?'); params.push(changes.labels) }

    if (changes.email !== undefined && normalizeEmail(changes.email) !== existing.email) {
      // A changed address has not been proved; nor has any session that was
      // proving the old one, so they end.
      sets.push('email = ?', 'email_verified_at = NULL', 'session_version = session_version + 1')
      params.push(normalizeEmail(changes.email))
    }

    if (changes.status !== undefined && changes.status !== existing.status) {
      sets.push('status = ?', 'unsubscribed_at = ?')
      params.push(changes.status, changes.status === 'unsubscribed' ? now : null)
    }

    if (sets.length) {
      sets.push('updated_at = ?')
      params.push(now)
      await db.run(`UPDATE members SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
    }

    return this.find(id)
  },

  /** Following a magic link proves the address and counts as a visit. */
  async markVerified(id: number): Promise<void> {
    const db = await getDb()
    const now = new Date().toISOString()
    await db.run(
      'UPDATE members SET email_verified_at = COALESCE(email_verified_at, ?), last_seen_at = ? WHERE id = ?',
      [now, now, id]
    )
  },

  /**
   * Record a visit, at most once an hour.
   *
   * Every member read would otherwise be a write, on the hottest path the
   * public API has. An hour is fine-grained enough for "last seen".
   */
  async touch(row: MemberRow): Promise<void> {
    // Through parseStoredTimestamp: SQLite hands back text, Postgres a Date.
    const last = parseStoredTimestamp(row.last_seen_at as string | Date | null)
    if (Date.now() - (Number.isNaN(last) ? 0 : last) < 60 * 60 * 1000) return

    const db = await getDb()
    await db.run('UPDATE members SET last_seen_at = ? WHERE id = ?', [new Date().toISOString(), row.id])
  },

  /** End every session the member holds. */
  async revokeSessions(id: number): Promise<void> {
    const db = await getDb()
    await db.run('UPDATE members SET session_version = session_version + 1 WHERE id = ?', [id])
  },

  async delete(id: number): Promise<void> {
    const db = await getDb()
    // Queue rows and tokens go with it by cascade on Postgres; SQLite only
    // honours ON DELETE when foreign keys are switched on, so say it here too.
    await db.run('DELETE FROM newsletter_queue WHERE member_id = ? AND status IN (?, ?)', [id, 'pending', 'sending'])
    await db.run('DELETE FROM member_tokens WHERE member_id = ?', [id])
    await db.run('DELETE FROM members WHERE id = ?', [id])
  },

  /** The admin listing: search over address, name and labels, optionally one status. */
  async paginate({ perPage, offset, search, status }: { perPage: number; offset: number; search?: string; status?: MemberStatus }) {
    const db = await getDb()
    const where: string[] = []
    const params: unknown[] = []

    if (status) {
      where.push('status = ?')
      params.push(status)
    }

    if (search) {
      // Lowered on both sides for Postgres, as Post.paginate does, and `%`/`_`
      // in the search are literal.
      const needle = `%${search.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`
      where.push("(LOWER(email) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(name, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(labels, '')) LIKE ? ESCAPE '\\')")
      params.push(needle, needle, needle)
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const members = (await db.all(
      `SELECT * FROM members ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    )) as MemberRow[]

    const counted = await db.get(`SELECT COUNT(*) AS total FROM members ${clause}`, params)

    return { members, total: Number(counted?.total) || 0 }
  },

  /** Totals for the counters above the list. */
  async counts(): Promise<{ total: number; active: number; unsubscribed: number }> {
    const db = await getDb()
    const rows = (await db.all('SELECT status, COUNT(*) AS total FROM members GROUP BY status')) as Array<{ status: string; total: number | string }>
    const of = (status: string) => Number(rows.find(row => row.status === status)?.total) || 0

    return {
      total: rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
      active: of('active'),
      unsubscribed: of('unsubscribed')
    }
  },

  /** Everyone, for the CSV export. Ordered so two exports diff cleanly. */
  async all(): Promise<MemberRow[]> {
    const db = await getDb()
    return db.all('SELECT * FROM members ORDER BY id ASC')
  }
}
