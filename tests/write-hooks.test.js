/**
 * The `*.creating` / `*.updating` / `*.deleting` filters run strict (framework
 * 0.7.0): a listener that throws refuses the write instead of being logged
 * and skipped. Returning `{ cancel: true }` still refuses, and a 403 it asks
 * for is kept. Other filters are unchanged: a throw there is still skipped.
 */

import { test, describe, before, after, afterEach } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)

const scratch = mkdtempSync(join(tmpdir(), 'basicben-write-hooks-'))
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'write-hooks-test-key-that-is-long-enough-to-sign'

let hooks, HOOKS, db, guardWrite, MEDIA_HOOKS, PostController, PageController, MediaController
const ids = {}
const LISTENER = 'test:refuser'

function response() {
  return {
    status: 200,
    json(data, status = 200) { this.body = data; this.status = status }
  }
}

const asAdmin = (body = {}, params = {}) => ({
  method: 'POST', body, params, headers: {}, query: {},
  userId: ids.admin, user: { id: ids.admin, role: 'admin', email_verified: true }
})

const quietly = async (fn) => {
  const original = console.error
  console.error = () => {}
  try { return await fn() } finally { console.error = original }
}

before(async () => {
  const { createMigrator } = await load('node_modules/@basicbenframework/core/src/db/migrator.js')
  await (await createMigrator()).migrate()
  db = await (await import('@basicbenframework/core/db')).getDb()
  ;({ hooks, HOOKS } = await import('@basicbenframework/core/hooks'))
  ;({ guardWrite, MEDIA_HOOKS } = await load('src/helpers/write-hooks.ts'))
  ;({ PostController } = await load('src/controllers/PostController.ts'))
  ;({ PageController } = await load('src/controllers/PageController.ts'))
  ;({ MediaController } = await load('src/controllers/MediaController.ts'))

  const user = await db.run("INSERT INTO users (name, email, password, role, email_verified) VALUES ('Ada', 'ada@example.test', 'x', 'admin', 1)")
  ids.admin = Number(user.lastInsertRowid)
  const media = await db.run(
    "INSERT INTO media (user_id, filename, original_name, path, mime_type, size, alt_text) VALUES (?, 'a.png', 'a.png', 'uploads/a.png', 'image/png', 10, 'before')",
    [ids.admin]
  )
  ids.media = Number(media.lastInsertRowid)
})

afterEach(() => {
  for (const hook of [...Object.values(HOOKS), ...Object.values(MEDIA_HOOKS)]) hooks.off(hook, LISTENER)
})

after(() => rmSync(scratch, { recursive: true, force: true }))

const count = async (table) => Number((await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n)

describe('guardWrite', () => {
  test('a throw refuses, with its message or, for public writes, the generic one', async () => {
    hooks.on('test.creating', () => { throw new Error('Needs a category') }, { name: LISTENER })
    try {
      const shown = await quietly(() => guardWrite('test.creating', { a: 1 }, {}, { refused: 'Rejected.' }))
      assert.deepStrictEqual(shown, { ok: false, error: 'Needs a category', status: 422 })

      const hidden = await quietly(() => guardWrite('test.creating', { a: 1 }, {}, { refused: 'Rejected.', showErrors: false }))
      assert.deepStrictEqual(hidden, { ok: false, error: 'Rejected.', status: 422 })
    } finally {
      hooks.off('test.creating', LISTENER)
    }
  })

  test('cancel refuses with its reason; only 403 is kept as a status', async () => {
    hooks.on('test.creating', (v) => ({ ...v, cancel: true, reason: 'No.', status: 500 }), { name: LISTENER })
    try {
      assert.deepStrictEqual(await guardWrite('test.creating', {}, {}, { refused: 'R' }), { ok: false, error: 'No.', status: 422 })
    } finally {
      hooks.off('test.creating', LISTENER)
    }
  })

  test('other filters still skip a listener that throws', async () => {
    hooks.on('test.other', () => { throw new Error('boom') }, { name: LISTENER })
    try {
      assert.deepStrictEqual(await quietly(() => hooks.filter('test.other', { a: 1 })), { a: 1 })
    } finally {
      hooks.off('test.other', LISTENER)
    }
  })
})

describe('posts and pages', () => {
  test('a throwing post.creating listener refuses the post', async () => {
    hooks.on(HOOKS.POST_CREATING, () => { throw new Error('Posts need a category') }, { name: LISTENER })
    const before = await count('posts')
    const res = response()
    await quietly(() => PostController.store(asAdmin({ title: 'Refused', content: 'Long enough content' }), res))
    assert.strictEqual(res.status, 422)
    assert.strictEqual(res.body.error, 'Posts need a category')
    assert.strictEqual(await count('posts'), before)
  })

  test('a post.updating refusal may be a 403', async () => {
    const created = response()
    await PostController.store(asAdmin({ title: 'Kept', content: 'Long enough content' }), created)
    assert.strictEqual(created.status, 201)

    hooks.on(HOOKS.POST_UPDATING, (v) => ({ ...v, cancel: true, reason: 'Not yours.', status: 403 }), { name: LISTENER })
    const res = response()
    await PostController.update({ ...asAdmin({ title: 'Changed', content: 'Long enough content' }, { id: String(created.body.post.id) }), method: 'PUT' }, res)
    assert.strictEqual(res.status, 403)
    assert.strictEqual((await db.get('SELECT title FROM posts WHERE id = ?', [created.body.post.id])).title, 'Kept')
  })

  test('a throwing page.deleting listener keeps the page', async () => {
    const created = response()
    await PageController.store(asAdmin({ title: 'About', content: 'Hello' }), created)
    assert.strictEqual(created.status, 201, JSON.stringify(created.body))

    hooks.on(HOOKS.PAGE_DELETING, () => { throw new Error('In the menu') }, { name: LISTENER })
    const res = response()
    await quietly(() => PageController.destroy(asAdmin({}, { id: String(created.body.page.id) }), res))
    assert.strictEqual(res.status, 422)
    assert.ok(await db.get('SELECT id FROM pages WHERE id = ?', [created.body.page.id]))
  })
})

describe('media', () => {
  test('media.updating can refuse, and can change what is saved', async () => {
    hooks.on(MEDIA_HOOKS.UPDATING, () => { throw new Error('Alt text is locked') }, { name: LISTENER })
    const refused = response()
    await quietly(() => MediaController.update(asAdmin({ alt_text: 'after' }, { id: String(ids.media) }), refused))
    assert.strictEqual(refused.status, 422)
    assert.strictEqual((await db.get('SELECT alt_text FROM media WHERE id = ?', [ids.media])).alt_text, 'before')

    hooks.off(MEDIA_HOOKS.UPDATING, LISTENER)
    hooks.on(MEDIA_HOOKS.UPDATING, (v) => ({ ...v, alt_text: v.alt_text.trim() }), { name: LISTENER })
    const saved = response()
    await MediaController.update(asAdmin({ alt_text: '  after  ' }, { id: String(ids.media) }), saved)
    assert.strictEqual(saved.status, 200)
    assert.strictEqual((await db.get('SELECT alt_text FROM media WHERE id = ?', [ids.media])).alt_text, 'after')
  })

  test('media.deleting can refuse', async () => {
    hooks.on(MEDIA_HOOKS.DELETING, (v) => ({ ...v, cancel: true, reason: 'Still used by a post.' }), { name: LISTENER })
    const res = response()
    await MediaController.destroy(asAdmin({}, { id: String(ids.media) }), res)
    assert.strictEqual(res.status, 422)
    assert.strictEqual(res.body.error, 'Still used by a post.')
    assert.ok(await db.get('SELECT id FROM media WHERE id = ?', [ids.media]))
  })
})
