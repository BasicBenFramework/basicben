/**
 * Phase 3, operations: site health and backups. Analytics, now a feature, is
 * tested in src/features/analytics/analytics.test.js.
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

import { recordHeartbeat, readHeartbeats, HEARTBEATS } from '../src/helpers/heartbeat.ts'
import { CMS_MIGRATIONS } from '../src/config.ts'
import { evaluateHealth, overallStatus, pendingMigrations, databaseFacts, migrationFilesIn, isServerless, ago } from '../src/helpers/health.ts'
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
} from '../src/cli/lib/backup.mjs'
import { readExport } from '../src/cli/lib/json-import.mjs'

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
      rateLimitRows: 100_000
    }), now))

    const expect = {
      app_key: 'fail', database: 'fail', migrations: 'fail', storage: 'fail', mail: 'warn', site_url: 'fail',
      trust_proxy: 'warn', webhook_secret: 'fail', cron_secret: 'warn', registration: 'warn',
      publish_due: 'warn', admin_2fa: 'warn', rate_limits: 'warn', backup: 'warn'
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
    const files = migrationFilesIn(CMS_MIGRATIONS)
    assert.ok(files.includes('036_create_analytics') && files.includes('037_create_ops_heartbeats'))
    assert.strictEqual(migrationFilesIn('no/such/dir'), null)
    // defineSite's list: a site with no migrations of its own is not "not shipped".
    assert.deepStrictEqual(migrationFilesIn([CMS_MIGRATIONS, 'no/such/dir']), files)
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
    assert.deepStrictEqual(pendingMigrations(migrationFilesIn(CMS_MIGRATIONS), result.migrationsRan), [])
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

  test('the maintenance cron is an alias of the tick, behind CRON_SECRET', () => {
    const controller = read('src/controllers/HealthController.ts')
    const block = controller.slice(controller.indexOf('async maintenance'))
    assert.match(block, /if \(!cronAuthorized\(req\)\)/)
    assert.match(block, /runCron\(\)/)
    assert.match(read('src/host/cron.ts'), /Boolean\(secret\) && .*timingSafeEqual/)
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

    const settings = { bucket: 'set-media', accessKeyId: 'sa', secretAccessKey: 'ss', endpoint: 'https://set.r2', region: 'auto', publicUrl: 'https://files.example' }

    // Storage set up in Settings is the media bucket when S3_BUCKET is not set.
    const fromSettings = backupStorageConfig({}, settings)
    assert.strictEqual(fromSettings.config.bucket, 'set-media')
    assert.strictEqual(fromSettings.config.secretAccessKey, 'ss')
    assert.strictEqual(fromSettings.config.endpoint, 'https://set.r2')
    assert.strictEqual(fromSettings.shared, true)
    assert.strictEqual(fromSettings.publicMediaUrl, true)
    assert.strictEqual(fromSettings.source, 'settings')

    // A dedicated bucket borrows the settings' keys for what it leaves out.
    const ownOnSettings = backupStorageConfig({ BACKUP_S3_BUCKET: 'bk' }, settings)
    assert.strictEqual(ownOnSettings.config.bucket, 'bk')
    assert.strictEqual(ownOnSettings.config.accessKeyId, 'sa')
    assert.strictEqual(ownOnSettings.shared, false)

    // S3_BUCKET puts the whole media group under the environment: no keys
    // from settings are mixed into it.
    assert.strictEqual(backupStorageConfig({ S3_BUCKET: 'env-media' }, settings), null)
    assert.strictEqual(backupStorageConfig({ S3_BUCKET: 'm', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' }, settings).config.bucket, 'm')

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
    // A site runs them through the package's bin, which maps each name to its file.
    const site = JSON.parse(read('site/package.json'))
    assert.strictEqual(site.scripts.backup, 'basicben-cms backup')
    assert.strictEqual(site.scripts.restore, 'basicben-cms restore')
    const bin = read('src/cli/index.mjs')
    assert.match(bin, /backup: '\.\/backup\.mjs'/)
    assert.match(bin, /restore: '\.\/restore\.mjs'/)
    assert.strictEqual(JSON.parse(read('package.json')).bin['basicben-cms'], './lib/cli/index.mjs')
    assert.match(read('src/cli/backup.mjs'), /log\(PERSONAL_DATA_WARNING\)/)
    // Backups hold personal data: ignored here and in every new site.
    assert.match(read('.gitignore'), /^backups\/$/m)
    assert.match(read('site/gitignore'), /^backups\/$/m)
  })
})
