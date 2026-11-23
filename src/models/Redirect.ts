/**
 * Redirects, and the rules that keep the table sane.
 *
 * Two invariants, both enforced on write so that every reader can trust them:
 *
 * - **No loops.** A→B→A would bounce a browser until it gives up, and a front
 *   end building its redirect map at deploy time might never finish resolving
 *   it. Manual entries that would close a loop are refused.
 * - **No redirect away from live content.** When a post takes back a slug it
 *   once had, the redirect from that path is deleted — otherwise the old rule
 *   would shadow the live post and nobody could reach it.
 *
 * Automatic entries (a published post or page changing its slug) also collapse
 * chains: if A→B exists and B moves to C, A is rewritten to point at C, so a
 * post renamed five times is one hop from every old URL, not five.
 *
 * Every function takes an optional `db` so the logic can be exercised against
 * an in-memory database in tests; in the app it is always `getDb()`.
 */

import { getDb } from '@basicbenframework/core/db'
import { normalizeRedirectSource, normalizeRedirectTarget, targetPath } from '../helpers/content-paths.ts'

export interface RedirectRow {
  id: number
  from_path: string
  to_path: string
  status: number
  source: string
  hits: number
  created_at: string
  updated_at: string
}

/** The subset of the framework's adapter these functions use. */
export interface RedirectDb {
  get(sql: string, params?: unknown[]): Promise<any>
  all(sql: string, params?: unknown[]): Promise<any[]>
  run(sql: string, params?: unknown[]): Promise<unknown>
}

export const REDIRECT_STATUSES = [301, 302] as const
export type RedirectSource = 'manual' | 'post' | 'page'

/** How far `resolve` follows a chain before deciding it is a loop. */
const MAX_HOPS = 20

const conn = async (db?: RedirectDb): Promise<RedirectDb> => db ?? ((await getDb()) as RedirectDb)

/**
 * Follow redirects from `start` to wherever they finally land.
 *
 * Returns the final target and the paths visited, or `loop: true` if the
 * chain comes back on itself (or runs past MAX_HOPS, which only a loop or a
 * pathological table would).
 */
async function follow(
  next: (path: string) => Promise<string | undefined>,
  start: string
): Promise<{ target: string; visited: string[]; loop: boolean }> {
  const visited: string[] = []
  let target = start

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const path = targetPath(target)
    if (!path) return { target, visited, loop: false }
    if (visited.includes(path)) return { target, visited, loop: true }

    visited.push(path)

    const to = await next(path)
    if (to === undefined) return { target, visited, loop: false }

    target = to
  }

  return { target, visited, loop: true }
}

/**
 * Resolve every redirect in `rows` to its final destination, in memory.
 *
 * Used by the public list: whatever chains the table holds (manual entries can
 * point at each other), a front end gets a single hop per path. A row that is
 * part of a loop is dropped — applying it would never terminate.
 */
export function resolveChains<T extends { from_path: string; to_path: string }>(rows: T[]): T[] {
  const byFrom = new Map(rows.map(row => [row.from_path, row]))
  const resolved: T[] = []

  for (const row of rows) {
    const seen = new Set([row.from_path])
    let target = row.to_path
    let loop = false

    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const path = targetPath(target)
      const next = path ? byFrom.get(path) : undefined
      if (!next) break
      if (seen.has(next.from_path)) { loop = true; break }
      seen.add(next.from_path)
      target = next.to_path
    }

    if (!loop) resolved.push({ ...row, to_path: target })
  }

  return resolved
}

export type RedirectInput = { from_path?: unknown; to_path?: unknown; status?: unknown }

/** Validate and normalise an admin's redirect. */
export function validateRedirect(input: RedirectInput):
  | { values: { from_path: string; to_path: string; status: number } }
  | { errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {}

  const from = normalizeRedirectSource(input.from_path)
  const to = normalizeRedirectTarget(input.to_path)
  const status = input.status === undefined || input.status === '' ? 301 : Number(input.status)

  if (!from) errors.from_path = ['Must be a path on this site, such as /old-page']
  if (!to) errors.to_path = ['Must be a path starting with / or an http(s) URL']
  if (!(REDIRECT_STATUSES as readonly number[]).includes(status)) errors.status = ['Must be 301 or 302']
  if (from && to && targetPath(to) === from) errors.to_path = ['A redirect cannot point at itself']

  if (Object.keys(errors).length) return { errors }

  return { values: { from_path: from!, to_path: to!, status } }
}

export const Redirect = {
  async paginate(
    { perPage, offset, search }: { perPage: number; offset: number; search?: string },
    db?: RedirectDb
  ): Promise<{ redirects: RedirectRow[]; total: number }> {
    const d = await conn(db)
    const where = search ? 'WHERE from_path LIKE ? OR to_path LIKE ?' : ''
    const params = search ? [`%${search}%`, `%${search}%`] : []

    const redirects = await d.all(
      `SELECT * FROM redirects ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    )
    const count = await d.get(`SELECT COUNT(*) AS total FROM redirects ${where}`, params)

    return { redirects, total: Number(count?.total ?? 0) }
  },

  async find(id: number, db?: RedirectDb): Promise<RedirectRow | undefined> {
    return (await conn(db)).get('SELECT * FROM redirects WHERE id = ?', [id])
  },

  async findByPath(path: string, db?: RedirectDb): Promise<RedirectRow | undefined> {
    return (await conn(db)).get('SELECT * FROM redirects WHERE from_path = ?', [path])
  },

  /** Every redirect, chains resolved, for the public list. */
  async allResolved(db?: RedirectDb): Promise<RedirectRow[]> {
    const rows = await (await conn(db)).all('SELECT * FROM redirects ORDER BY from_path')
    return resolveChains(rows)
  },

  /**
   * The redirect for one path, its chain resolved to the final destination.
   * Undefined when nothing matches, or when the chain loops.
   */
  async lookup(path: string, db?: RedirectDb): Promise<RedirectRow | undefined> {
    const d = await conn(db)
    const row: RedirectRow | undefined = await d.get('SELECT * FROM redirects WHERE from_path = ?', [path])
    if (!row) return undefined

    const { target, loop } = await follow(async (next) => {
      if (next === row.from_path) return row.to_path
      const hop = await d.get('SELECT to_path FROM redirects WHERE from_path = ?', [next])
      return hop?.to_path
    }, row.from_path)

    return loop ? undefined : { ...row, to_path: target }
  },

  /**
   * Would `from → to` close a loop with what is already stored?
   *
   * `ignoreId` is the row being edited, which must not count against itself.
   */
  async wouldLoop(from: string, to: string, ignoreId?: number, db?: RedirectDb): Promise<boolean> {
    const d = await conn(db)
    const existing = ignoreId ? await d.get('SELECT from_path FROM redirects WHERE id = ?', [ignoreId]) : null

    // The edited row's current rule is about to be replaced, so the chain is
    // followed as if it were gone.
    const { visited, loop } = await follow(async (path) => {
      if (existing && path === existing.from_path) return undefined
      const row = await d.get('SELECT to_path FROM redirects WHERE from_path = ?', [path])
      return row?.to_path
    }, to)

    return loop || visited.includes(from)
  },

  /**
   * Create or replace the redirect from `from_path`.
   *
   * Anything that pointed at `from_path` is re-pointed at the new target in
   * the same step: `from_path` is now a redirect, not a destination, and
   * leaving them would make every old link two hops instead of one.
   */
  async save(
    values: { from_path: string; to_path: string; status: number },
    source: RedirectSource,
    db?: RedirectDb
  ): Promise<RedirectRow> {
    const d = await conn(db)
    const now = new Date().toISOString()

    await d.run(
      'UPDATE redirects SET to_path = ?, updated_at = ? WHERE to_path = ?',
      [values.to_path, now, values.from_path]
    )

    const existing = await d.get('SELECT id FROM redirects WHERE from_path = ?', [values.from_path])

    if (existing) {
      await d.run(
        'UPDATE redirects SET to_path = ?, status = ?, source = ?, updated_at = ? WHERE id = ?',
        [values.to_path, values.status, source, now, existing.id]
      )
    } else {
      // Raw INSERT, then a read by the unique path: this works the same on
      // every adapter without depending on RETURNING for the new id.
      await d.run(
        `INSERT INTO redirects (from_path, to_path, status, source, hits, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [values.from_path, values.to_path, values.status, source, now, now]
      )
    }

    // Any self-redirect the re-pointing above could have produced.
    await d.run('DELETE FROM redirects WHERE from_path = to_path')

    return d.get('SELECT * FROM redirects WHERE from_path = ?', [values.from_path])
  },

  async update(
    id: number,
    values: { from_path: string; to_path: string; status: number },
    db?: RedirectDb
  ): Promise<RedirectRow> {
    const d = await conn(db)
    const now = new Date().toISOString()

    await d.run(
      'UPDATE redirects SET from_path = ?, to_path = ?, status = ?, source = ?, updated_at = ? WHERE id = ?',
      [values.from_path, values.to_path, values.status, 'manual', now, id]
    )

    return d.get('SELECT * FROM redirects WHERE id = ?', [id])
  },

  async delete(id: number, db?: RedirectDb): Promise<void> {
    await (await conn(db)).run('DELETE FROM redirects WHERE id = ?', [id])
  },

  /** Count a lookup. Best effort: a lost increment is not worth failing a read. */
  async hit(id: number, db?: RedirectDb): Promise<void> {
    try {
      await (await conn(db)).run('UPDATE redirects SET hits = hits + 1 WHERE id = ?', [id])
    } catch {
      // ignored — see above
    }
  },

  /**
   * A published post or page moved from `oldPath` to `newPath`.
   *
   * 1. `newPath` is live content now, so any redirect *from* it goes — it
   *    would shadow the content (this is the "slug taken back" case).
   * 2. Redirects that pointed at `oldPath` are re-pointed at `newPath`
   *    (chain collapse: A→B plus B→C becomes A→C and B→C).
   * 3. `oldPath → newPath` is recorded as a 301.
   *
   * Step 1 before 3 is what prevents a two-step loop: renaming a→b then b→a
   * deletes a→b before it would record b→a.
   */
  async recordSlugChange(kind: 'post' | 'page', oldPath: string, newPath: string, db?: RedirectDb): Promise<void> {
    const from = normalizeRedirectSource(oldPath)
    const to = normalizeRedirectSource(newPath)

    if (!from || !to || from === to) return

    const d = await conn(db)

    await d.run('DELETE FROM redirects WHERE from_path = ?', [to])
    await this.save({ from_path: from, to_path: to, status: 301 }, kind, d)
  },

  /** Content was created at `path`: a redirect away from it must not shadow it. */
  async releasePath(path: string, db?: RedirectDb): Promise<void> {
    const normalized = normalizeRedirectSource(path)
    if (!normalized) return
    await (await conn(db)).run('DELETE FROM redirects WHERE from_path = ?', [normalized])
  }
}
