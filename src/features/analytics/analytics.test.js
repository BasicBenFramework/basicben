/**
 * The analytics feature: what counts as a page view, the counting itself
 * against a real migrated SQLite database, and what the feature registers
 * with the host. Lives with the feature, so removing the folder removes its
 * tests too.
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  normalizeAnalyticsPath,
  referrerDomain,
  hostOf,
  isBot,
  optedOut,
  parseHitBody,
  visitorHash,
  fillSeries
} from './helpers.ts'
import { recordHit, purge, summary, analyticsSettings, clearSaltCache, OTHER, MAX_PATHS_PER_DAY, PURGE_HEARTBEAT } from './model.ts'
import analyticsFeature from './index.ts'
import { readHeartbeats } from '../../helpers/heartbeat.ts'
import { validateSettings, defineSettings } from '../../helpers/site-settings.ts'
import { NEVER_EXPORTED } from '../../helpers/export-data.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const CORE = join(ROOT, 'node_modules/@basicbenframework/core/src/db')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

/** A fresh database at the current schema. */
async function freshDb() {
  const { createSqliteAdapter } = await import(join(CORE, 'adapters/sqlite.js'))
  const { createMigrator } = await import(join(CORE, 'migrator.js'))
  const db = await createSqliteAdapter(':memory:', { wal: false })
  await (await createMigrator(join(ROOT, 'db/migrations'), db)).migrate()
  return db
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

describe('analytics: what counts as a page, a referrer, a bot', () => {
  test('paths are normalised, and queries and fragments always dropped', () => {
    assert.strictEqual(normalizeAnalyticsPath('/blog/hello/'), '/blog/hello')
    assert.strictEqual(normalizeAnalyticsPath('/blog//hello'), '/blog/hello')
    assert.strictEqual(normalizeAnalyticsPath('/'), '/')
    assert.strictEqual(normalizeAnalyticsPath('/reset?token=abc&email=a@b.c'), '/reset')
    assert.strictEqual(normalizeAnalyticsPath('/a#section'), '/a')
    assert.strictEqual(normalizeAnalyticsPath('https://example.com/post/x?utm_source=y'), '/post/x')
    assert.strictEqual(normalizeAnalyticsPath('https://example.com'), '/')
  })

  test('anything that is not a path is refused', () => {
    for (const bad of [null, 42, '', 'blog', '//evil.example/x', 'javascript:alert(1)', 'ftp://x/y', '/a b', '/a\nb', '/' + 'x'.repeat(400)]) {
      assert.strictEqual(normalizeAnalyticsPath(bad), null, JSON.stringify(bad))
    }
  })

  test('referrers are reduced to a domain, and the site itself is not one', () => {
    assert.strictEqual(referrerDomain('https://www.google.com/search?q=private+thing'), 'google.com')
    assert.strictEqual(referrerDomain('https://news.ycombinator.com/item?id=1'), 'news.ycombinator.com')
    assert.strictEqual(referrerDomain('https://blog.example.com/a', ['blog.example.com']), null)
    assert.strictEqual(referrerDomain('https://www.blog.example.com/a', ['blog.example.com']), null)
    assert.strictEqual(referrerDomain('android-app://com.google.android.gm'), null)
    assert.strictEqual(referrerDomain('not a url'), null)
    assert.strictEqual(referrerDomain(undefined), null)
    assert.strictEqual(hostOf('https://Example.com/x'), 'example.com')
    assert.strictEqual(hostOf(undefined), null)
  })

  test('bots, monitors, libraries and empty user agents are not counted', () => {
    for (const ua of ['', '   ', undefined, 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'curl/8.4.0',
      'python-requests/2.31', 'facebookexternalhit/1.1', 'Mozilla/5.0 (compatible; bingbot/2.0)',
      'Mozilla/5.0 HeadlessChrome/120', 'UptimeRobot/2.0', 'node-fetch/1.0']) {
      assert.ok(isBot(ua), `${ua} should be a bot`)
    }
    assert.ok(!isBot(UA))
    assert.ok(!isBot('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'))
  })

  test('Do Not Track and Global Privacy Control opt out', () => {
    assert.ok(optedOut({ dnt: '1' }))
    assert.ok(optedOut({ 'sec-gpc': '1' }))
    assert.ok(!optedOut({ dnt: '0' }))
    assert.ok(!optedOut({}))
  })

  test('visitor hashes depend on salt and scope, and are not the inputs', () => {
    const a = visitorHash('salt-1', '203.0.113.7', UA)
    assert.match(a, /^[0-9a-f]{32}$/)
    assert.strictEqual(a, visitorHash('salt-1', '203.0.113.7', UA))
    assert.notStrictEqual(a, visitorHash('salt-2', '203.0.113.7', UA), 'a new salt is a new visitor')
    assert.notStrictEqual(a, visitorHash('salt-1', '203.0.113.7', UA, '/a'), 'per-path rows are unrelated to the site row')
    assert.ok(!a.includes('203'))
  })

  test('hit bodies arrive as objects or as text/plain JSON', () => {
    assert.deepStrictEqual(parseHitBody('{"path":"/a"}'), { path: '/a' })
    assert.deepStrictEqual(parseHitBody({ path: '/b' }), { path: '/b' })
    assert.deepStrictEqual(parseHitBody('nonsense'), {})
    assert.deepStrictEqual(parseHitBody(undefined), {})
  })

  test('series fill missing days with zero, oldest first', () => {
    const now = new Date('2026-11-23T12:00:00Z')
    const series = fillSeries([{ day: '2026-11-22', views: 5, visitors: 2 }], 3, now)
    assert.deepStrictEqual(series.map((d) => d.day), ['2026-11-21', '2026-11-22', '2026-11-23'])
    assert.deepStrictEqual(series.map((d) => d.views), [0, 5, 0])
  })
})

describe('analytics: counting against the database', () => {
  let db
  const day1 = new Date('2026-11-23T10:00:00Z')

  beforeEach(async () => {
    clearSaltCache()
    db = await freshDb()
  })

  const hit = (path, extra = {}) => recordHit({
    path,
    referrer: null,
    address: '203.0.113.7',
    userAgent: UA,
    pepper: 'app-key',
    now: day1,
    ...extra
  }, db)

  test('a repeat visit is a view, not a visitor; another page is a visitor of that page', async () => {
    await hit('/a')
    await hit('/a')
    await hit('/b', { referrer: 'news.ycombinator.com' })
    await hit('/a', { address: '198.51.100.1' })

    const total = await db.get("SELECT views, visitors FROM analytics_totals WHERE day = '2026-11-23'")
    assert.deepStrictEqual({ ...total }, { views: 4, visitors: 2 })

    const a = await db.get("SELECT views, visitors FROM analytics_daily WHERE path = '/a'")
    assert.deepStrictEqual({ ...a }, { views: 3, visitors: 2 })
    const b = await db.get("SELECT views, visitors FROM analytics_daily WHERE path = '/b'")
    assert.deepStrictEqual({ ...b }, { views: 1, visitors: 1 })

    const ref = await db.get('SELECT domain, views FROM analytics_referrers')
    assert.deepStrictEqual({ ...ref }, { domain: 'news.ycombinator.com', views: 1 })
  })

  test('no address, user agent or salt-free hash is written anywhere', async () => {
    await hit('/a')
    await hit('/b')

    const tables = (await db.all("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name)
    let dump = ''
    for (const table of tables) dump += JSON.stringify(await db.all(`SELECT * FROM "${table}"`))

    assert.ok(!dump.includes('203.0.113.7'), 'the address is stored somewhere')
    assert.ok(!dump.includes('Safari'), 'the user agent is stored somewhere')
    assert.ok(!dump.includes(visitorHash('', '203.0.113.7', UA)), 'a hash without the day salt is stored')
  })

  test('the next day has a new salt, so the same reader is a new visitor', async () => {
    await hit('/a')
    await hit('/a', { now: new Date('2026-11-24T09:00:00Z') })
    const rows = await db.all('SELECT day, visitors FROM analytics_totals ORDER BY day')
    assert.deepStrictEqual(rows.map((r) => r.visitors), [1, 1])
    const salts = await db.all('SELECT day, salt FROM analytics_salts ORDER BY day')
    assert.strictEqual(salts.length, 2)
    assert.notStrictEqual(salts[0].salt, salts[1].salt)
  })

  test('the purge deletes old hashes and every salt before today, and honours retention', async () => {
    await hit('/old', { now: new Date('2026-10-01T10:00:00Z') })
    await hit('/a')

    const result = await purge({ now: new Date('2026-11-24T00:30:00Z'), dedupHours: 24, retentionDays: 30 }, db)
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM analytics_salts')).n, 0)
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM analytics_seen')).n, 0, 'yesterday\'s hashes outlived their salt')
    assert.ok(result.aggregates >= 2, 'October counts past the 30-day retention were kept')
    assert.strictEqual((await db.get("SELECT COUNT(*) AS n FROM analytics_daily WHERE path = '/a'")).n, 1)

    const beats = await readHeartbeats(db)
    assert.ok(beats[PURGE_HEARTBEAT], 'the purge did not report in')
  })

  test('a shorter dedup window forgets sooner within the day', async () => {
    await hit('/a')
    await purge({ now: new Date('2026-11-23T13:00:00Z'), dedupHours: 2, retentionDays: 0 }, db)
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM analytics_seen')).n, 0)
  })

  test('new paths past the daily cap fold into (other)', async () => {
    for (let i = 0; i < MAX_PATHS_PER_DAY; i++) {
      await db.run("INSERT INTO analytics_daily (day, path, views, visitors) VALUES ('2026-11-23', ?, 1, 1)", [`/p${i}`])
    }
    const result = await hit('/brand-new')
    assert.strictEqual(result.path, OTHER)
    const known = await hit('/p1')
    assert.strictEqual(known.path, '/p1', 'a path already counted today keeps counting')
  })

  test('the summary totals, ranks and fills the range', async () => {
    await hit('/a')
    await hit('/a', { address: '198.51.100.1' })
    await hit('/b', { referrer: 'example.org' })

    const s = await summary({ days: 7, now: day1 }, db)
    assert.strictEqual(s.series.length, 7)
    assert.strictEqual(s.to, '2026-11-23')
    assert.deepStrictEqual(s.totals, { views: 3, visitors: 2 })
    assert.deepStrictEqual(s.top_paths[0], { path: '/a', views: 2, visitors: 2 })
    assert.deepStrictEqual(s.top_referrers, [{ domain: 'example.org', views: 1 }])
  })

  test('settings default to on, a 24-hour window and no retention limit', async () => {
    assert.deepStrictEqual(await analyticsSettings(db), { enabled: true, dedupHours: 24, retentionDays: 0 })
    await db.run("INSERT INTO settings (key, value, group_name) VALUES ('analytics_enabled', 'false', 'analytics')")
    assert.strictEqual((await analyticsSettings(db)).enabled, false)
  })
})

describe('analytics: as a feature', () => {
  // A stand-in for the host that records what the feature registers. Settings
  // go to the real allowlist, so validateSettings sees them.
  const registered = { routes: [], tasks: [], checks: [] }
  analyticsFeature.register({
    hooks: null,
    routes: (fn) => fn(Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((method) =>
      [method, (path, ...handlers) => registered.routes.push({ method, path, handlers })]))),
    settings: { define: defineSettings },
    cron: { task: (name, everySeconds, run) => registered.tasks.push({ name, everySeconds, run }) },
    health: { check: (name, run) => registered.checks.push({ name, run }) }
  })
  const route = (method, path) => registered.routes.find((r) => r.method === method && r.path === path)

  test('the settings are on the allowlist with bounds', () => {
    assert.ok('values' in validateSettings({ analytics_enabled: false, analytics_dedup_hours: 12, analytics_retention_days: 0 }))
    assert.ok('errors' in validateSettings({ analytics_dedup_hours: 48 }), 'more than a day of hashes is pointless')
    assert.ok('errors' in validateSettings({ analytics_dedup_hours: 0 }))
    assert.ok('errors' in validateSettings({ analytics_retention_days: -1 }))
  })

  test('the ingest route is public but rate-limited; the summary needs a capability', () => {
    const hit = route('post', '/api/v1/analytics/hit')
    assert.ok(hit, 'no ingest route')
    assert.strictEqual(hit.handlers.length, 2, 'ingest is the limiter and the controller, nothing that needs a credential')
    const source = read('src/features/analytics/index.ts')
    assert.match(source, /router\.post\('\/api\/v1\/analytics\/hit', analyticsHitLimit, AnalyticsController\.hit\)/)
    assert.match(source, /'\/api\/admin\/analytics', auth, requireCapability\('post\.edit'\)/)
    assert.ok(route('get', '/api/admin/analytics'))
  })

  test('the limiter keys on a hash of the address, never the address', () => {
    const source = read('src/features/analytics/index.ts')
    const block = source.slice(source.indexOf('export const analyticsHitLimit'))
    assert.match(block, /createHash\('sha256'\)/)
    assert.match(block, /`analytics:\$\{hashed\}`/)
  })

  test('the controller drops opt-outs and bots before touching the database', () => {
    const controller = read('src/features/analytics/controller.ts')
    const optOut = controller.indexOf('optedOut(req.headers)')
    const record = controller.indexOf('await recordHit(')
    assert.ok(optOut > 0 && optOut < record)
  })

  test('the purge is scheduled, so hashes expire on a quiet day', () => {
    assert.deepStrictEqual(registered.tasks.map((t) => [t.name, t.everySeconds]), [['purge', 600]])
  })

  test('the health check warns about hashes past their window', async () => {
    const db = await freshDb()
    const [{ run }] = registered.checks
    const now = new Date('2026-11-23T12:00:00Z')
    assert.strictEqual((await run({ db, now, env: {} })).status, 'pass')
    await db.run('INSERT INTO analytics_seen (hash, day, created_at) VALUES (?, ?, ?)', ['h', '2026-11-21', now.getTime() - 30 * 3_600_000])
    const found = await run({ db, now, env: {} })
    assert.strictEqual(found.status, 'warn')
    assert.ok(found.hint)
    const broken = { get: async () => { throw new Error('no table') } }
    assert.strictEqual(await run({ db: broken, now, env: {} }), null, 'a missing table adds nothing rather than failing')
  })

  test('salts, hashes and heartbeats never leave the database in an export', () => {
    for (const table of ['analytics_salts', 'analytics_seen', 'ops_heartbeats']) {
      assert.ok(NEVER_EXPORTED.includes(table), table)
    }
  })
})

