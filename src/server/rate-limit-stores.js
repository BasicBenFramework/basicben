/**
 * Storage for rate limiter state.
 *
 * A store keeps the timestamps of recent hits per key and answers two
 * questions: how many are still inside the window, and is this key blocked.
 */

import { Grammar } from '../db/Grammar.js'

/**
 * In-process storage.
 *
 * The default, and the right choice for smoothing traffic. **Not** the right
 * choice for a security control: a restart clears it, and a second instance has
 * its own copy, so a lockout it enforces is neither durable nor shared.
 */
export class MemoryStore {
  #entries = new Map()
  #timer = null

  /**
   * @param {Object} [options]
   * @param {number} [options.sweepInterval] - ms between sweeps of stale keys
   */
  constructor(options = {}) {
    this.sweepInterval = options.sweepInterval ?? 60_000

    if (this.sweepInterval > 0) {
      this.#timer = setInterval(() => this.sweep(), this.sweepInterval)
      // Do not hold the process open; a limiter should never be why a CLI hangs.
      this.#timer.unref?.()
    }
  }

  async hit(key, { windowMs, now, limit, blockMs }) {
    const entry = this.#current(key, windowMs, now)

    if (entry.blockedUntil && entry.blockedUntil > now) {
      return { count: entry.hits.length, blocked: true, blockedUntil: entry.blockedUntil }
    }

    entry.hits.push(now)

    // Only enough timestamps to know when the oldest leaves the window; past
    // the limit the exact count stops mattering and the array stops growing.
    if (entry.hits.length > limit + 1) {
      entry.hits = entry.hits.slice(-(limit + 1))
    }

    if (blockMs && entry.hits.length > limit) {
      entry.blockedUntil = now + blockMs
      return { count: entry.hits.length, blocked: true, blockedUntil: entry.blockedUntil }
    }

    return {
      count: entry.hits.length,
      blocked: false,
      resetAt: entry.hits[0] + windowMs
    }
  }

  async peek(key, { windowMs, now }) {
    const entry = this.#current(key, windowMs, now)

    if (entry.blockedUntil && entry.blockedUntil > now) {
      return { count: entry.hits.length, blocked: true, blockedUntil: entry.blockedUntil }
    }

    return {
      count: entry.hits.length,
      blocked: false,
      resetAt: (entry.hits[0] ?? now) + windowMs
    }
  }

  async reset(key) {
    this.#entries.delete(key)
  }

  /** Drop keys with nothing left inside their window. */
  sweep(now = Date.now()) {
    for (const [key, entry] of this.#entries) {
      const live = entry.hits.some((t) => t > now - entry.windowMs)
      const blocked = entry.blockedUntil && entry.blockedUntil > now

      if (!live && !blocked) this.#entries.delete(key)
    }
  }

  /** Stop the sweep timer. */
  close() {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }

  get size() {
    return this.#entries.size
  }

  #current(key, windowMs, now) {
    let entry = this.#entries.get(key)

    if (!entry) {
      entry = { hits: [], blockedUntil: null, windowMs }
      this.#entries.set(key, entry)
    }

    entry.windowMs = windowMs
    entry.hits = entry.hits.filter((t) => t > now - windowMs)

    if (entry.blockedUntil && entry.blockedUntil <= now) {
      // The block has lapsed; start the count again rather than leaving the
      // key one hit away from locking immediately.
      entry.blockedUntil = null
      entry.hits = []
    }

    return entry
  }
}

/**
 * Database-backed storage.
 *
 * Survives a restart and is shared between instances, which is what a lockout
 * needs. Requires the `rate_limits` table.
 */
export class DatabaseStore {
  /**
   * @param {Object} options
   * @param {Function} options.getDb - resolves the database connection
   * @param {string} [options.table]
   */
  constructor({ getDb, table = 'rate_limits' } = {}) {
    if (!getDb) throw new Error('DatabaseStore requires getDb')
    this.getDb = getDb
    this.table = table
  }

  async hit(key, { windowMs, now, limit, blockMs }) {
    const db = await this.getDb()
    const row = await this.#load(db, key, windowMs, now)

    if (row.blockedUntil && row.blockedUntil > now) {
      return { count: row.hits.length, blocked: true, blockedUntil: row.blockedUntil }
    }

    const hits = [...row.hits, now].slice(-(limit + 1))
    let blockedUntil = null

    if (blockMs && hits.length > limit) {
      blockedUntil = now + blockMs
    }

    await this.#save(db, key, hits, blockedUntil, now)

    if (blockedUntil) {
      return { count: hits.length, blocked: true, blockedUntil }
    }

    return { count: hits.length, blocked: false, resetAt: hits[0] + windowMs }
  }

  async peek(key, { windowMs, now }) {
    const db = await this.getDb()
    const row = await this.#load(db, key, windowMs, now)

    if (row.blockedUntil && row.blockedUntil > now) {
      return { count: row.hits.length, blocked: true, blockedUntil: row.blockedUntil }
    }

    return { count: row.hits.length, blocked: false, resetAt: (row.hits[0] ?? now) + windowMs }
  }

  /**
   * Placeholders for the connected driver.
   *
   * These statements are written by hand rather than through the query builder,
   * so nothing was substituting `$1` for `?` — every one of them was a syntax
   * error on Postgres. Since the limiter runs in front of login and register,
   * that made those routes 500 on a Postgres app rather than merely losing the
   * throttle.
   *
   * @param {number} count
   * @returns {string[]}
   */
  async #marks(count) {
    const db = await this.getDb()
    const grammar = new Grammar(db.driver || 'sqlite')

    return Array.from({ length: count }, (_, i) => grammar.placeholder(i))
  }

  async reset(key) {
    const db = await this.getDb()
    const [p1] = await this.#marks(1)
    await db.run(`DELETE FROM ${this.table} WHERE key = ${p1}`, [key])
  }

  /** Remove rows whose window and block have both lapsed. */
  async sweep(now = Date.now()) {
    const db = await this.getDb()
    const [p1, p2] = await this.#marks(2)
    const result = await db.run(
      `DELETE FROM ${this.table} WHERE updated_at < ${p1} AND (blocked_until IS NULL OR blocked_until < ${p2})`,
      [now - 86_400_000, now]
    )
    return result.changes ?? 0
  }

  async #load(db, key, windowMs, now) {
    const [p1] = await this.#marks(1)
    const row = await db.get(
      `SELECT hits, blocked_until FROM ${this.table} WHERE key = ${p1}`,
      [key]
    )

    if (!row) return { hits: [], blockedUntil: null }

    const blockedUntil = row.blocked_until ? Number(row.blocked_until) : null

    if (blockedUntil && blockedUntil <= now) {
      return { hits: [], blockedUntil: null }
    }

    let hits = []
    try {
      const parsed = JSON.parse(row.hits ?? '[]')
      if (Array.isArray(parsed)) hits = parsed.filter((t) => t > now - windowMs)
    } catch {
      hits = []
    }

    return { hits, blockedUntil }
  }

  async #save(db, key, hits, blockedUntil, now) {
    // One statement so two concurrent requests cannot both insert the same key.
    //
    // The update reads EXCLUDED rather than re-binding the same four values.
    // Both dialects support it, and it keeps the parameter count matching the
    // placeholder count — which is the mistake numbered placeholders punish.
    const [p1, p2, p3, p4] = await this.#marks(4)

    await db.run(
      `INSERT INTO ${this.table} (key, hits, blocked_until, updated_at)
       VALUES (${p1}, ${p2}, ${p3}, ${p4})
       ON CONFLICT(key) DO UPDATE SET
         hits = EXCLUDED.hits,
         blocked_until = EXCLUDED.blocked_until,
         updated_at = EXCLUDED.updated_at`,
      [key, JSON.stringify(hits), blockedUntil, now]
    )
  }
}
