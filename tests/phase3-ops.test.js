/**
 * Phase 3, operations: site health, backups and privacy-friendly analytics.
 *
 * The rules are pure functions and are tested directly. Anything that is a
 * function of what the tables hold — counting, purging, restoring — runs
 * against real in-memory SQLite databases migrated with this repository's
 * migrations, the way the phase 2 suites do. Wiring (who may call what) is
 * checked in the source.
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert'
import { readFileSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'

import {
  normalizeAnalyticsPath,
  referrerDomain,
  hostOf,
  isBot,
  optedOut,
  visitorHash,
  parseHitBody,
  fillSeries
} from '../src/helpers/analytics.ts'
import { recordHit, purge, summary, analyticsSettings, clearSaltCache, OTHER, MAX_PATHS_PER_DAY } from '../src/models/Analytics.ts'
import { recordHeartbeat, readHeartbeats, HEARTBEATS } from '../src/helpers/heartbeat.ts'
import { evaluateHealth, overallStatus, pendingMigrations, databaseFacts, migrationFilesIn, isServerless, ago } from '../src/helpers/health.ts'
import { validateSettings } from '../src/helpers/site-settings.ts'
import { NEVER_EXPORTED } from '../src/helpers/export-data.ts'
import {
  backupBaseName,
  parseBackupName,
  selectForDeletion,
  backupStorageConfig,
  normalizePrefix,
  writeJsonBackup,
  sqliteSnapshot,
  pruneLocal,
  pruneBucket,
  isGzip,
  restoreBackup,
  nonEmptyTables
} from '../scripts/lib/backup.mjs'
import { readExport } from '../scripts/lib/json-import.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
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

async function withAdmin(db) {
  await db.run(
    "INSERT INTO users (name, email, password, role, slug) VALUES ('Admin', 'admin@example.com', 'x:y:1:1:1:1', 'admin', 'admin')"
  )
  return (await db.get("SELECT id FROM users WHERE email = 'admin@example.com'")).id
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

// ---------------------------------------------------------------------------

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
    assert.ok(beats[HEARTBEATS.ANALYTICS_PURGE], 'the purge did not report in')
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

describe('analytics: settings and wiring', () => {
  test('the settings are on the allowlist with bounds', () => {
    assert.ok('values' in validateSettings({ analytics_enabled: false, analytics_dedup_hours: 12, analytics_retention_days: 0 }))
    assert.ok('errors' in validateSettings({ analytics_dedup_hours: 48 }), 'more than a day of hashes is pointless')
    assert.ok('errors' in validateSettings({ analytics_dedup_hours: 0 }))
    assert.ok('errors' in validateSettings({ analytics_retention_days: -1 }))
  })

  test('the ingest route is public but rate-limited; the summary needs a capability', () => {
    const routes = read('src/routes/api/ops.ts')
    assert.match(routes, /router\.post\('\/api\/v1\/analytics\/hit', analyticsHitLimit, AnalyticsController\.hit\)/)
    assert.match(routes, /'\/api\/admin\/analytics', auth, requireCapability\('post\.edit'\)/)
  })

  test('the limiter keys on a hash of the address, never the address', () => {
    const limits = read('src/middleware/rate-limits.ts')
    const block = limits.slice(limits.indexOf('export const analyticsHitLimit'))
    assert.match(block, /createHash\('sha256'\)/)
    assert.match(block, /`analytics:\$\{hashed\}`/)
  })

  test('the controller drops opt-outs and bots before touching the database', () => {
    const controller = read('src/controllers/AnalyticsController.ts')
    const optOut = controller.indexOf('optedOut(req.headers)')
    const record = controller.indexOf('await recordHit(')
    assert.ok(optOut > 0 && optOut < record)
  })

  test('salts, hashes and heartbeats never leave the database in an export', () => {
    for (const table of ['analytics_salts', 'analytics_seen', 'ops_heartbeats']) {
      assert.ok(NEVER_EXPORTED.includes(table), table)
    }
  })
})

// ---------------------------------------------------------------------------

describe('site health', () => {
  const facts = (over = {}) => ({
    nodeVersion: '24.1.0',
    frameworkVersion: '0.6.0',
    dbDriver: 'turso',
    migrationFiles: ['001_a', '002_b'],
    migrationsRan: ['001_a', '002_b'],
    storageDriver: 's3',
    mailTransport: 'resend',
    mailFrom: 'Blog <hi@blog.example>',
    settings: {},
    heartbeats: {},
    dueUnannounced: 0,
    rateLimitRows: 10,
    adminsTotal: 1,
    adminsWithout2fa: 0,
    staleAnalyticsHashes: 0,
    ...over
  })

  const good = {
    NODE_ENV: 'production',
    VERCEL: '1',
    APP_KEY: 'k'.repeat(64),
    SITE_URL: 'https://blog.example',
    TRUST_PROXY: '1',
    CRON_SECRET: 'c'.repeat(32),
    DISABLE_REGISTRATION: 'true',
    S3_PUBLIC_URL: 'https://cdn.blog.example',
    S3_ACCESS_KEY_ID: 'AKIASECRETVALUE',
    S3_SECRET_ACCESS_KEY: 'very-secret-access-key',
    WEBHOOK_SECRET: 'w'.repeat(40)
  }
  const now = new Date('2026-11-23T12:00:00Z')
  const byId = (checks) => Object.fromEntries(checks.map((c) => [c.id, c]))

  test('a well-configured serverless deployment passes apart from the backup reminder', () => {
    const checks = byId(evaluateHealth(good, facts({ heartbeats: { backup: { last_run_at: '2026-11-22T03:00:00Z', detail: null } } }), now))
    const notPass = Object.values(checks).filter((c) => c.status !== 'pass')
    assert.deepStrictEqual(notPass.map((c) => c.id), [])
  })

  test('secrets are reported by presence and length, never by value', () => {
    const env = { ...good, APP_KEY: 'super-secret-app-key-value-0123456789', DATABASE_URL: 'postgres://u:dbpassword@h/db' }
    const out = JSON.stringify(evaluateHealth(env, facts({ settings: { webhook_urls: 'https://hooks.example/x' } }), now))
    for (const secret of [env.APP_KEY, good.CRON_SECRET, good.WEBHOOK_SECRET, good.S3_SECRET_ACCESS_KEY, good.S3_ACCESS_KEY_ID, 'dbpassword']) {
      assert.ok(!out.includes(secret), `health output contains ${secret}`)
    }
    assert.match(out, /37 characters/)
  })

  test('the production mistakes each fail or warn with a hint', () => {
    const env = { NODE_ENV: 'production', VERCEL: '1', APP_KEY: 'short', APP_URL: 'http://blog.example' }
    const checks = byId(evaluateHealth(env, facts({
      dbDriver: 'sqlite',
      migrationsRan: ['001_a'],
      storageDriver: 'local',
      mailTransport: 'console',
      settings: { webhook_urls: 'https://hooks.example/x' },
      dueUnannounced: 2,
      adminsWithout2fa: 1,
      rateLimitRows: 100_000,
      staleAnalyticsHashes: 3
    }), now))

    const expect = {
      app_key: 'fail', database: 'fail', migrations: 'fail', storage: 'fail', mail: 'warn', site_url: 'fail',
      trust_proxy: 'warn', webhook_secret: 'fail', cron_secret: 'warn', registration: 'warn',
      publish_due: 'warn', admin_2fa: 'warn', rate_limits: 'warn', analytics_purge: 'warn', backup: 'warn'
    }
    for (const [id, status] of Object.entries(expect)) {
      assert.strictEqual(checks[id].status, status, `${id}: ${checks[id].message}`)
      assert.ok(checks[id].hint, `${id} has no fix hint`)
    }
    assert.match(checks.migrations.message, /002_b/)
    assert.strictEqual(overallStatus(Object.values(checks)), 'fail')
  })

  test('development is lenient where production is strict', () => {
    const checks = byId(evaluateHealth({ NODE_ENV: 'development', APP_KEY: 'k'.repeat(40) }, facts({ storageDriver: 'local', mailTransport: 'console', dbDriver: 'sqlite' }), now))
    assert.strictEqual(checks.node_env.status, 'warn')
    assert.strictEqual(checks.storage.status, 'pass')
    assert.strictEqual(checks.mail.status, 'pass')
    assert.strictEqual(checks.registration.status, 'pass')
    assert.strictEqual(checks.database.status, 'pass')
  })

  test('an old Node, a missing migrations directory and a stale backup are flagged', () => {
    const checks = byId(evaluateHealth(good, facts({
      nodeVersion: '22.11.0',
      migrationFiles: null,
      heartbeats: { backup: { last_run_at: '2026-11-01T00:00:00Z', detail: null } }
    }), now))
    assert.strictEqual(checks.node_version.status, 'fail')
    assert.strictEqual(checks.migrations.status, 'warn')
    assert.strictEqual(checks.backup.status, 'warn')
  })

  test('helpers', () => {
    assert.deepStrictEqual(pendingMigrations(['1', '2', '3'], ['1', '3']), ['2'])
    assert.ok(isServerless({ VERCEL: '1' }))
    assert.ok(!isServerless({}))
    assert.strictEqual(ago('2026-11-23T11:57:00Z', now), '3 minutes ago')
    const files = migrationFilesIn('db/migrations')
    assert.ok(files.includes('036_create_analytics') && files.includes('037_create_ops_heartbeats'))
    assert.strictEqual(migrationFilesIn('no/such/dir'), null)
  })

  test('database facts read a migrated database', async () => {
    const db = await freshDb()
    const adminId = await withAdmin(db)
    await db.run("INSERT INTO users (name, email, password, role, slug) VALUES ('B', 'b@example.com', 'x', 'admin', 'b')")
    await db.run('INSERT INTO user_two_factor (user_id, totp_secret, totp_enabled_at) VALUES (?, ?, ?)', [adminId, 'S', '2026-01-01'])

    const result = await databaseFacts(db, now)
    assert.strictEqual(result.adminsTotal, 2)
    assert.strictEqual(result.adminsWithout2fa, 1)
    assert.strictEqual(result.rateLimitRows, 0)
    assert.strictEqual(result.staleAnalyticsHashes, 0)
    assert.deepStrictEqual(pendingMigrations(migrationFilesIn('db/migrations'), result.migrationsRan), [])
  })

  test('heartbeats round-trip and never throw', async () => {
    const db = await freshDb()
    await recordHeartbeat(db, HEARTBEATS.BACKUP, { file: 'x.json' }, now)
    await recordHeartbeat(db, HEARTBEATS.BACKUP, { file: 'y.json' }, now)
    const beats = await readHeartbeats(db)
    assert.deepStrictEqual(beats.backup.detail, { file: 'y.json' })

    const broken = { run: async () => { throw new Error('no table') }, all: async () => { throw new Error('no table') }, get: async () => undefined }
    await recordHeartbeat(broken, 'x')
    assert.deepStrictEqual(await readHeartbeats(broken), {})
  })

  test('health is admin-only, by session, and the live checks are rate-limited', () => {
    const routes = read('src/routes/api/ops.ts')
    assert.match(routes, /const admin = \[auth, requireSession, requireRole\(ROLES\.ADMIN\)\]/)
    assert.match(routes, /'\/api\/admin\/health', \.\.\.admin, HealthController\.index/)
    assert.match(routes, /storage-probe', \.\.\.admin, healthActionLimit/)
    assert.match(routes, /test-email', \.\.\.admin, healthActionLimit/)
  })

  test('the test email only ever goes to the signed-in account', () => {
    const controller = read('src/controllers/HealthController.ts')
    const block = controller.slice(controller.indexOf('async testEmail'), controller.indexOf('async maintenance'))
    assert.match(block, /User\.find\(req\.userId/)
    assert.ok(!/req\.body/.test(block), 'the recipient must not come from the request')
  })

  test('the maintenance cron needs CRON_SECRET, compared in constant time', () => {
    const controller = read('src/controllers/HealthController.ts')
    const block = controller.slice(controller.indexOf('async maintenance'))
    assert.match(block, /if \(!secret \|\|/)
    assert.match(block, /timingSafeEqual/)
  })

  test('scheduled publishing reports in', () => {
    assert.match(read('src/helpers/publish-due.ts'), /recordHeartbeat\(.*HEARTBEATS\.PUBLISH_DUE/)
  })
})

// ---------------------------------------------------------------------------

describe('backups', () => {
  test('names sort by time, are unguessable, and parse back', () => {
    const name = backupBaseName(new Date('2026-11-23T10:15:00.123Z'), 'a'.repeat(16))
    assert.strictEqual(name, 'basicben-backup-20261123T101500123Z-aaaaaaaaaaaaaaaa')
    assert.match(backupBaseName(), /-[0-9a-f]{16}$/)
    const parsed = parseBackupName(`backups/${name}.json.gz`)
    assert.strictEqual(parsed.date.toISOString(), '2026-11-23T10:15:00.123Z')
    assert.strictEqual(parsed.ext, '.json.gz')
    assert.strictEqual(parseBackupName('notes.txt'), null)
    assert.strictEqual(parseBackupName('basicben-backup-latest.json'), null)
  })

  test('retention counts backup sets and never touches other files', () => {
    const names = [
      'basicben-backup-20261101T000000000Z-1111111111111111.json.gz',
      'basicben-backup-20261101T000000000Z-1111111111111111.sqlite',
      'basicben-backup-20261102T000000000Z-2222222222222222.json.gz',
      'basicben-backup-20261103T000000000Z-3333333333333333.json.gz',
      'basicben-backup-20261103T000000000Z-3333333333333333.sqlite',
      'important.sqlite',
      'basicben-export-2026-11-01.json'
    ]
    assert.deepStrictEqual(selectForDeletion(names, 2), names.slice(0, 2))
    assert.deepStrictEqual(selectForDeletion(names, 5), [])
    assert.throws(() => selectForDeletion(names, 0))
  })

  test('bucket config prefers a dedicated backup bucket, and says when it is the media bucket', () => {
    assert.strictEqual(backupStorageConfig({}), null)

    const own = backupStorageConfig({ BACKUP_S3_BUCKET: 'bk', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's', S3_ENDPOINT: 'https://r2' })
    assert.strictEqual(own.config.bucket, 'bk')
    assert.strictEqual(own.config.endpoint, 'https://r2', 'unset BACKUP_S3_* fall back to S3_*')
    assert.strictEqual(own.shared, false)

    const shared = backupStorageConfig({ S3_BUCKET: 'media', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's', S3_PUBLIC_URL: 'https://cdn' })
    assert.strictEqual(shared.shared, true)
    assert.strictEqual(shared.publicMediaUrl, true)

    assert.strictEqual(normalizePrefix('/backups'), 'backups/')
    assert.throws(() => normalizePrefix('../x'))
    assert.throws(() => normalizePrefix('/'))
  })

  describe('against a database', () => {
    let dir
    let source

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), 'bb-backup-'))
      source = await freshDb()
      const adminId = await withAdmin(source)
      await source.run(
        "INSERT INTO posts (user_id, title, content, slug, status, published) VALUES (?, 'Hello', 'Body', 'hello', 'published', 1)",
        [adminId]
      )
      const post = await source.get("SELECT id FROM posts WHERE slug = 'hello'")
      await source.run("INSERT INTO post_revisions (post_id, user_id, title, content) VALUES (?, ?, 'Hello v1', 'Old body')", [post.id, adminId])
      await source.run("INSERT INTO user_two_factor (user_id, totp_secret) VALUES (?, 'TOTPSECRETVALUE')", [adminId])
      await source.run("INSERT INTO api_tokens (user_id, name, token_hash, scopes, created_at) VALUES (?, 't', 'APITOKENHASH', '[]', '2026-01-01')", [adminId])
      await source.run("INSERT INTO settings (key, value, group_name) VALUES ('smtp_password', 'MAILPASSWORD', 'general')")
    })

    const cleanup = () => rmSync(dir, { recursive: true, force: true })

    test('the JSON backup includes revisions, gzips, and carries no secrets', async () => {
      try {
        const path = join(dir, 'b.json.gz')
        await writeJsonBackup(source, path, { gzip: true })
        const raw = readFileSync(path)
        assert.ok(isGzip(raw))
        const text = gunzipSync(raw).toString('utf-8')
        const doc = readExport(text)
        assert.strictEqual(doc.tables.post_revisions.length, 1)
        for (const secret of ['x:y:1:1:1:1', 'TOTPSECRETVALUE', 'APITOKENHASH', 'MAILPASSWORD']) {
          assert.ok(!text.includes(secret), `backup contains ${secret}`)
        }
      } finally {
        cleanup()
      }
    })

    test('the SQLite copy is consistent and scrubbed, free pages included', async () => {
      try {
        const path = join(dir, 'b.sqlite')
        await sqliteSnapshot(source, path)

        const bytes = readFileSync(path).toString('latin1')
        for (const secret of ['x:y:1:1:1:1', 'TOTPSECRETVALUE', 'APITOKENHASH', 'MAILPASSWORD']) {
          assert.ok(!bytes.includes(secret), `the copy still contains ${secret}`)
        }

        const copy = new DatabaseSync(path)
        assert.strictEqual(copy.prepare("SELECT title FROM posts WHERE slug = 'hello'").get().title, 'Hello')
        assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM _migrations').get().n > 30, 'the migrations record must survive')
        copy.close()

        await assert.rejects(sqliteSnapshot({ driver: 'turso' }, path), /sqlite driver/)
      } finally {
        cleanup()
      }
    })

    test('restore goes into an empty database only, and a dry run writes nothing', async () => {
      try {
        const path = join(dir, 'b.json')
        await writeJsonBackup(source, path)
        const doc = readExport(readFileSync(path, 'utf-8'))

        await assert.rejects(restoreBackup(source, doc), /not empty/)

        const target = await freshDb()
        assert.deepStrictEqual(await nonEmptyTables(target), {})

        const dry = await restoreBackup(target, doc, { dryRun: true })
        assert.strictEqual(dry.content.get('posts', 'created'), 1)
        assert.deepStrictEqual(await nonEmptyTables(target), {}, 'the dry run wrote something')

        const real = await restoreBackup(target, doc)
        assert.strictEqual(real.accounts.get('users', 'created'), 1)
        const post = await target.get("SELECT p.title, u.email FROM posts p JOIN users u ON u.id = p.user_id WHERE p.slug = 'hello'")
        assert.deepStrictEqual({ ...post }, { title: 'Hello', email: 'admin@example.com' })
        assert.strictEqual((await target.get('SELECT COUNT(*) AS n FROM post_revisions')).n, 1)
        const admin = await target.get("SELECT role, password FROM users WHERE email = 'admin@example.com'")
        assert.strictEqual(admin.role, 'admin')
        assert.match(admin.password, /^!imported:/)

        // Forced: merges, matching what is already there.
        const again = await restoreBackup(target, doc, { force: true })
        assert.strictEqual(again.content.get('posts', 'created'), 0)
      } finally {
        cleanup()
      }
    })

    test('a restore that fails partway leaves the database empty', async () => {
      const target = await freshDb()
      const bad = { format: 'basicben-export', version: 1, tables: { users: [{ id: 1, email: 'a@example.com', name: 'A', role: 'admin', slug: 'a' }], posts: [{ id: 1, user_id: 1, title: null, slug: 'x' }] } }
      await assert.rejects(restoreBackup(target, bad))
      assert.deepStrictEqual(await nonEmptyTables(target), {})
    })
  })

  test('local and bucket retention delete only old backups', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-prune-'))
    try {
      const names = [
        'basicben-backup-20261101T000000000Z-1111111111111111.json',
        'basicben-backup-20261102T000000000Z-2222222222222222.json',
        'keep-me.txt'
      ]
      for (const name of names) writeFileSync(join(dir, name), 'x')
      assert.deepStrictEqual(await pruneLocal(dir, 1), [names[0]])
      assert.deepStrictEqual(readdirSync(dir).sort(), [names[1], 'keep-me.txt'].sort())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }

    const keys = new Set([
      'backups/basicben-backup-20261101T000000000Z-1111111111111111.json.gz',
      'backups/basicben-backup-20261102T000000000Z-2222222222222222.json.gz',
      'backups/notes.txt'
    ])
    const deleted = []
    const fake = {
      // Two pages, to exercise the continuation token.
      async list({ prefix, cursor }) {
        const all = [...keys].filter((k) => k.startsWith(prefix)).sort()
        return cursor ? { items: all.slice(2).map((key) => ({ key })), cursor: null } : { items: all.slice(0, 2).map((key) => ({ key })), cursor: 'next' }
      },
      async delete(key) { deleted.push(key); keys.delete(key) }
    }
    await pruneBucket(fake, 'backups/', 1)
    assert.deepStrictEqual(deleted, ['backups/basicben-backup-20261101T000000000Z-1111111111111111.json.gz'])
  })

  test('the CLIs are wired as npm scripts and warn about personal data', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.match(pkg.scripts.backup, /scripts\/backup\.mjs/)
    assert.match(pkg.scripts.restore, /scripts\/restore\.mjs/)
    assert.match(read('scripts/backup.mjs'), /log\(PERSONAL_DATA_WARNING\)/)
    assert.match(read('.gitignore'), /^backups\/$/m)
  })
})
