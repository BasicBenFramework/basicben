/**
 * The mysendbox feature listed but not set up (no MYSENDBOX_API_KEY): it
 * listens to nothing, so members sends through its own queue exactly as it
 * does without this feature. Its own process, because features register once.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)

const scratch = mkdtempSync(join(tmpdir(), 'basicben-mysendbox-off-'))
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'mysendbox-off-test-key-that-is-long-enough'
delete process.env.MYSENDBOX_API_KEY

let db, hooks, newsletter

before(async () => {
  const { createMigrator } = await load('node_modules/@basicbenframework/core/src/db/migrator.js')
  await (await createMigrator()).migrate()
  db = await (await import('@basicbenframework/core/db')).getDb()
  ;({ hooks } = await import('@basicbenframework/core/hooks'))
  await (await load('src/host/index.ts')).registerFeatures([
    (await load('src/features/members/index.ts')).default,
    (await load('src/features/mysendbox/index.ts')).default
  ])
  newsletter = await load('src/features/members/newsletter.ts')
})

after(() => rmSync(scratch, { recursive: true, force: true }))

test('without a key it takes nothing, and the built-in queue sends', async () => {
  assert.strictEqual(hooks.has('newsletter.delivering'), false)
  assert.strictEqual(hooks.has('member.created'), false)

  const user = await db.run("INSERT INTO users (name, email, password, role, email_verified) VALUES ('A', 'a@example.test', 'x', 'admin', 1)")
  await db.run("INSERT INTO members (email, status, source, session_version, created_at, updated_at) VALUES ('m@example.test', 'active', 'signup', 0, ?, ?)", [new Date().toISOString(), new Date().toISOString()])
  const at = new Date(Date.now() - 1000).toISOString()
  const post = await db.run(
    `INSERT INTO posts (title, slug, content, content_html, user_id, published, status, publish_at, visibility, send_newsletter, created_at, updated_at)
     VALUES ('Built in', 'built-in', 'B', '<p>B</p>', ?, 1, 'published', ?, 'public', 1, ?, ?)`,
    [Number(user.lastInsertRowid), at, at, at]
  )

  const send = await newsletter.queueNewsletterFor(Number(post.lastInsertRowid))
  assert.strictEqual(send.status, 'sending')
  assert.strictEqual(send.provider ?? null, null)
  assert.strictEqual(Number(send.total_count), 1)
})
