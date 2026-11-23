/**
 * Page-view counts: recording a hit, purging what must not be kept, and the
 * summaries the admin reads.
 *
 * Every function takes an optional `db` so the logic runs against an
 * in-memory database in tests; in the app it is always `getDb()`. The privacy
 * model — what is stored, for how long, and why — is in migration 036 and
 * src/features/analytics/README.md; this file is where it is enforced.
 */

import { randomBytes } from 'node:crypto'
import { getDb } from '@basicbenframework/core/db'
import { utcDay, daysBefore, visitorHash, fillSeries } from './helpers.ts'
import { recordHeartbeat } from '../../helpers/heartbeat.ts'

/** The heartbeat the purge records; the analytics health check reads it. */
export const PURGE_HEARTBEAT = 'analytics_purge'

export interface AnalyticsDb {
  driver?: string
  get: (sql: string, params?: unknown[]) => any
  all: (sql: string, params?: unknown[]) => any
  run: (sql: string, params?: unknown[]) => any
}

const conn = async (db?: AnalyticsDb): Promise<AnalyticsDb> => db ?? ((await getDb()) as AnalyticsDb)

/**
 * Distinct paths (and referrer domains) counted per day before the rest are
 * folded into `(other)`.
 *
 * The ingest endpoint is public, so without a cap anyone could add a row per
 * request by inventing paths, and the table would grow without bound. A real
 * blog has nowhere near this many pages read in one day.
 */
export const MAX_PATHS_PER_DAY = 5000
export const MAX_REFERRERS_PER_DAY = 1000
export const OTHER = '(other)'

export const DEFAULT_DEDUP_HOURS = 24

export interface AnalyticsSettings {
  enabled: boolean
  dedupHours: number
  retentionDays: number
}

/** The three analytics settings, with their defaults applied. */
export async function analyticsSettings(db?: AnalyticsDb): Promise<AnalyticsSettings> {
  const d = await conn(db)
  const rows = (await d.all(
    "SELECT key, value FROM settings WHERE key IN ('analytics_enabled', 'analytics_dedup_hours', 'analytics_retention_days')"
  )) as Array<{ key: string; value: string | null }>
  const value = (key: string) => rows.find((row) => row.key === key)?.value ?? null

  const hours = Number(value('analytics_dedup_hours'))
  const retention = Number(value('analytics_retention_days'))

  return {
    enabled: value('analytics_enabled') !== 'false',
    dedupHours: Number.isInteger(hours) && hours >= 1 && hours <= 24 ? hours : DEFAULT_DEDUP_HOURS,
    retentionDays: Number.isInteger(retention) && retention >= 0 ? retention : 0
  }
}

// One salt per day, cached per instance. The cache is an optimisation only:
// the row is the source of truth, so every instance hashes with the same salt.
const saltCache = new Map<string, string>()

/**
 * The day's salt, creating it if this is the day's first hit.
 *
 * Insert-if-absent then read, so two instances racing on the first hit of the
 * day agree on whichever salt landed first. Random rather than derived from
 * APP_KEY: a derived salt can be derived again after the day is over, and the
 * point of rotating it is that once it is deleted, yesterday's hashes cannot
 * be matched to anyone. (APP_KEY is still mixed into the hash by the caller,
 * so a database leak alone does not hand out today's salt in usable form.)
 */
export async function saltFor(day: string, db?: AnalyticsDb): Promise<string> {
  const cached = saltCache.get(day)
  if (cached) return cached

  const d = await conn(db)
  await d.run(
    'INSERT INTO analytics_salts (day, salt) VALUES (?, ?) ON CONFLICT(day) DO NOTHING',
    [day, randomBytes(32).toString('hex')]
  )
  const row = await d.get('SELECT salt FROM analytics_salts WHERE day = ?', [day])
  const salt = String(row.salt)

  // Only today's (and at the boundary, yesterday's) salt is ever wanted.
  if (saltCache.size > 4) saltCache.clear()
  saltCache.set(day, salt)

  return salt
}

/** Forget cached salts. For tests, and after a purge deletes them. */
export function clearSaltCache() {
  saltCache.clear()
}

/** True the first time this hash is seen; false for a repeat. */
async function firstSighting(d: AnalyticsDb, hash: string, day: string, now: number): Promise<boolean> {
  const result = await d.run(
    'INSERT INTO analytics_seen (hash, day, created_at) VALUES (?, ?, ?) ON CONFLICT(hash) DO NOTHING',
    [hash, day, now]
  )
  return Number(result?.changes ?? 0) > 0
}

export interface Hit {
  /** Already normalised by `normalizeAnalyticsPath`. */
  path: string
  /** Already reduced by `referrerDomain`, or null. */
  referrer: string | null
  /** The client address as the rate limiter sees it (IPv6 as its /64). */
  address: string
  userAgent: string
  /** Extra key material mixed into every hash: APP_KEY in the app. */
  pepper?: string
  now?: Date
}

/**
 * Count one page view.
 *
 * Neither the address nor the user agent is written anywhere: they go into a
 * hash with the day's salt, and only the hash is stored, in a table purged
 * once the UTC day is over (sooner, with a shorter dedup window). What is kept is the increment.
 */
export async function recordHit(hit: Hit, db?: AnalyticsDb): Promise<{ newVisitor: boolean; path: string }> {
  const d = await conn(db)
  const now = hit.now ?? new Date()
  const day = utcDay(now)
  const salt = (hit.pepper ?? '') + (await saltFor(day, d))

  // Fold an unseen path into (other) once the day's cap is reached.
  let path = hit.path
  const existing = await d.get('SELECT 1 AS present FROM analytics_daily WHERE day = ? AND path = ?', [day, path])
  if (!existing) {
    const row = await d.get('SELECT COUNT(*) AS n FROM analytics_daily WHERE day = ?', [day])
    if (Number(row?.n ?? 0) >= MAX_PATHS_PER_DAY) path = OTHER
  }

  const ms = now.getTime()
  const newVisitor = await firstSighting(d, visitorHash(salt, hit.address, hit.userAgent), day, ms)
  const newOnPath = await firstSighting(d, visitorHash(salt, hit.address, hit.userAgent, path), day, ms)

  await d.run(
    `INSERT INTO analytics_totals (day, views, visitors) VALUES (?, 1, ?)
     ON CONFLICT(day) DO UPDATE SET views = analytics_totals.views + 1, visitors = analytics_totals.visitors + excluded.visitors`,
    [day, newVisitor ? 1 : 0]
  )

  await d.run(
    `INSERT INTO analytics_daily (day, path, views, visitors) VALUES (?, ?, 1, ?)
     ON CONFLICT(day, path) DO UPDATE SET views = analytics_daily.views + 1, visitors = analytics_daily.visitors + excluded.visitors`,
    [day, path, newOnPath ? 1 : 0]
  )

  if (hit.referrer) {
    let domain = hit.referrer
    const known = await d.get('SELECT 1 AS present FROM analytics_referrers WHERE day = ? AND domain = ?', [day, domain])
    if (!known) {
      const row = await d.get('SELECT COUNT(*) AS n FROM analytics_referrers WHERE day = ?', [day])
      if (Number(row?.n ?? 0) >= MAX_REFERRERS_PER_DAY) domain = OTHER
    }

    await d.run(
      `INSERT INTO analytics_referrers (day, domain, views) VALUES (?, ?, 1)
       ON CONFLICT(day, domain) DO UPDATE SET views = analytics_referrers.views + 1`,
      [day, domain]
    )
  }

  return { newVisitor, path }
}

export interface PurgeResult {
  seen: number
  salts: number
  aggregates: number
}

/**
 * Delete what the privacy model says must not be kept.
 *
 * - visitor hashes older than the dedup window;
 * - every salt from before today, which makes any hash that survived
 *   unmatchable;
 * - daily counts older than the retention setting, when one is set.
 *
 * Runs from the ingest endpoint and the admin summary (throttled), and from
 * `GET /api/cron/maintenance`, so a site with no traffic still forgets on time.
 */
export async function purge(
  options: { now?: Date; dedupHours?: number; retentionDays?: number } = {},
  db?: AnalyticsDb
): Promise<PurgeResult> {
  const d = await conn(db)
  const now = options.now ?? new Date()
  const settings = options.dedupHours === undefined || options.retentionDays === undefined
    ? await analyticsSettings(d)
    : null
  const dedupHours = Math.min(24, options.dedupHours ?? settings!.dedupHours)
  const retentionDays = options.retentionDays ?? settings!.retentionDays
  const today = utcDay(now)

  const seen = await d.run('DELETE FROM analytics_seen WHERE created_at < ?', [now.getTime() - dedupHours * 3_600_000])
  // Hashes from an earlier day can never match again — its salt goes in the
  // next statement — so whatever the window, they are only liability now.
  const stale = await d.run('DELETE FROM analytics_seen WHERE day < ?', [today])
  const salts = await d.run('DELETE FROM analytics_salts WHERE day < ?', [today])
  clearSaltCache()

  let aggregates = 0
  if (retentionDays > 0) {
    const cutoff = daysBefore(now, retentionDays)
    for (const table of ['analytics_totals', 'analytics_daily', 'analytics_referrers']) {
      const result = await d.run(`DELETE FROM ${table} WHERE day < ?`, [cutoff])
      aggregates += Number(result?.changes ?? 0)
    }
  }

  const result = {
    seen: Number(seen?.changes ?? 0) + Number(stale?.changes ?? 0),
    salts: Number(salts?.changes ?? 0),
    aggregates
  }

  await recordHeartbeat(d, PURGE_HEARTBEAT, { ...result }, now)

  return result
}

let lastPurge = 0

/** `purge`, at most every ten minutes per instance. Never throws. */
export async function purgeOpportunistically(db?: AnalyticsDb): Promise<void> {
  if (Date.now() - lastPurge < 10 * 60_000) return
  lastPurge = Date.now()

  try {
    await purge({}, db)
  } catch (err) {
    console.error('[analytics] purge failed:', (err as Error).message)
  }
}

export interface AnalyticsSummary {
  days: number
  from: string
  to: string
  totals: { views: number; visitors: number }
  series: Array<{ day: string; views: number; visitors: number }>
  top_paths: Array<{ path: string; views: number; visitors: number }>
  top_referrers: Array<{ domain: string; views: number }>
}

/**
 * The admin's view of the last `days` days, today included.
 *
 * `totals.visitors` is the sum of daily uniques: a reader who came on three
 * days counts three times. Uniques across a range would need the hashes the
 * privacy model deletes, and that is the trade — the page says so.
 */
export async function summary(
  options: { days: number; now?: Date; limit?: number },
  db?: AnalyticsDb
): Promise<AnalyticsSummary> {
  const d = await conn(db)
  const now = options.now ?? new Date()
  const days = options.days
  const limit = options.limit ?? 20
  const from = daysBefore(now, days - 1)
  const to = utcDay(now)

  const rows = (await d.all(
    'SELECT day, views, visitors FROM analytics_totals WHERE day >= ? AND day <= ? ORDER BY day',
    [from, to]
  )) as Array<{ day: string; views: number; visitors: number }>

  const series = fillSeries(rows, days, now)

  const topPaths = (await d.all(
    `SELECT path, SUM(views) AS views, SUM(visitors) AS visitors FROM analytics_daily
     WHERE day >= ? AND day <= ? GROUP BY path ORDER BY SUM(views) DESC, path LIMIT ?`,
    [from, to, limit]
  )) as Array<{ path: string; views: unknown; visitors: unknown }>

  const topReferrers = (await d.all(
    `SELECT domain, SUM(views) AS views FROM analytics_referrers
     WHERE day >= ? AND day <= ? GROUP BY domain ORDER BY SUM(views) DESC, domain LIMIT ?`,
    [from, to, limit]
  )) as Array<{ domain: string; views: unknown }>

  return {
    days,
    from,
    to,
    totals: {
      views: series.reduce((sum, day) => sum + day.views, 0),
      visitors: series.reduce((sum, day) => sum + day.visitors, 0)
    },
    series,
    // SUM() comes back as a string on Postgres (bigint) — numbers for JSON.
    top_paths: topPaths.map((row) => ({ path: row.path, views: Number(row.views), visitors: Number(row.visitors) })),
    top_referrers: topReferrers.map((row) => ({ domain: row.domain, views: Number(row.views) }))
  }
}
