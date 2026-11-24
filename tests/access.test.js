/**
 * Core's access mechanism with no policy registered: the bare core, or a site
 * that removed the members feature.
 *
 * Deny by default: public posts are readable and nothing else is, whoever
 * asks. A post saved under a level no feature offers any more stays withheld
 * and can still be edited without being made public. The members feature's
 * own tests cover the same surfaces with its policy in place.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)

const scratch = mkdtempSync(join(tmpdir(), 'basicben-access-'))
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'access-test-key-that-is-long-enough-to-sign-with'

let access, gating, cacheable, db, PublicContent, PostController, FeedController
const ids = {}

function response() {
  return {
    status: 200,
    headers: {},
    json(data, status = 200) { this.body = data; this.status = status },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(text) { this.text = text },
    send(text) { this.text = text }
  }
}

before(async () => {
  const { createMigrator } = await load('node_modules/@basicbenframework/core/src/db/migrator.js')
  await (await createMigrator()).migrate()
  db = await (await import('@basicbenframework/core/db')).getDb()

  access = await load('src/helpers/access.ts')
  gating = await load('src/helpers/gating.ts')
  ;({ cacheable } = await load('src/middleware/cache.ts'))
  ;({ PublicContent } = await load('src/models/PublicContent.ts'))
  ;({ PostController } = await load('src/controllers/PostController.ts'))
  ;({ FeedController } = await load('src/controllers/FeedController.ts'))

  const user = await db.run("INSERT INTO users (name, email, password, role, email_verified) VALUES ('Ed', 'ed@example.test', 'x', 'editor', 1)")
  ids.editor = Number(user.lastInsertRowid)
  const now = new Date(Date.now() - 1000).toISOString()
  for (const [key, visibility] of [['open', 'public'], ['members', 'members'], ['vip', 'vip']]) {
    const result = await db.run(
      `INSERT INTO posts (title, slug, content, content_html, excerpt, user_id, published, status, publish_at, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'published', ?, ?, ?, ?)`,
      [`Post ${key}`, `post-${key}`, `BODY ${key}`, `<p>BODY ${key}</p>`, 'A teaser.', ids.editor, now, visibility, now, now]
    )
    ids[key] = Number(result.lastInsertRowid)
  }
})

after(() => rmSync(scratch, { recursive: true, force: true }))

describe('with no access policy', () => {
  test('only public is offered, and no header is a reader credential', () => {
    assert.strictEqual(access.hasAccessPolicy(), false)
    assert.deepStrictEqual(access.accessLevels(), ['public'])
    assert.deepStrictEqual(access.credentialHeaders(), [])
  })

  test('public is readable; every other level is withheld, whoever asks', async () => {
    const someone = { id: 1 }
    assert.strictEqual(access.mayRead({ visibility: 'public' }, null), true)
    assert.strictEqual(access.mayRead({ visibility: null }, null), true, 'blank is the column default, public')
    assert.strictEqual(access.mayRead({ visibility: 'members' }, someone), false)
    assert.strictEqual(access.mayRead({ visibility: 'vip' }, someone), false)

    const req = { headers: { 'x-member-token': 'anything' } }
    assert.strictEqual(await access.viewerOf(req), null)
    assert.strictEqual(req.viewer, null, 'remembered on the request')
  })

  test('the content API withholds restricted bodies even with a viewer', async () => {
    const { posts } = await PublicContent.posts({ perPage: 50, viewer: { id: 1 } })
    const byId = Object.fromEntries(posts.map((p) => [p.id, p]))
    assert.match(byId[ids.open].content, /BODY open/)
    for (const key of ['members', 'vip']) {
      assert.ok(byId[ids[key]], `${key} is still listed`)
      assert.strictEqual(byId[ids[key]].content, null)
      assert.strictEqual(byId[ids[key]].gated, true)
      assert.strictEqual(byId[ids[key]].fields, null)
    }
    assert.doesNotMatch(JSON.stringify(posts), /BODY members|BODY vip/)
  })

  test('the feeds and the built-in blog withhold them too', async () => {
    const rss = response()
    await FeedController.rss({ headers: { host: 'x' }, query: {} }, rss)
    assert.doesNotMatch(rss.text, /BODY members|BODY vip/)

    const feed = response()
    await PostController.feedShow({ params: { id: String(ids.members) }, headers: { 'x-member-token': 'anything' } }, feed)
    assert.strictEqual(feed.body.post.content_html, null)
    assert.strictEqual(feed.body.post.content, null)
  })

  test('responses vary on Authorization only, and an unknown header is not a credential', async () => {
    const res = response()
    await cacheable({ headers: { 'x-member-token': 'anything' } }, res, () => {})
    res.json({ ok: true })
    assert.strictEqual(res.headers.vary, 'Authorization')
    assert.match(res.headers['cache-control'], /^public/)
  })

  test('the editor accepts public, or the level the post already has', async () => {
    const asEditor = (body, params = {}) => ({
      method: 'PUT', body, params, headers: {}, userId: ids.editor, user: { id: ids.editor, role: 'editor', email_verified: true }
    })

    const created = response()
    await PostController.store(asEditor({ title: 'New members post', content: 'Long enough content', visibility: 'members' }), created)
    assert.strictEqual(created.status, 422, 'no policy offers members')
    assert.match(created.body.errors.visibility[0], /public/)

    const kept = response()
    await PostController.update(asEditor({ title: 'Post members', content: 'Long enough content here', visibility: 'members' }, { id: String(ids.members) }), kept)
    assert.strictEqual(kept.status, 200, JSON.stringify(kept.body))
    assert.strictEqual((await db.get('SELECT visibility FROM posts WHERE id = ?', [ids.members])).visibility, 'members')

    const opened = response()
    await PostController.update(asEditor({ title: 'Post members', content: 'Long enough content here', visibility: 'public' }, { id: String(ids.members) }), opened)
    assert.strictEqual(opened.status, 200)
  })

  test('the newsletter field is nothing to core', async () => {
    const res = response()
    await PostController.store({
      method: 'POST', body: { title: 'Asks for a send', content: 'Long enough content', send_newsletter: true }, params: {}, headers: {},
      userId: ids.editor, user: { id: ids.editor, role: 'editor', email_verified: true }
    }, res)
    assert.strictEqual(res.status, 201)
    const row = await db.get('SELECT send_newsletter FROM posts WHERE id = ?', [res.body.post.id])
    assert.strictEqual(Number(row.send_newsletter), 0, 'only the members feature writes it')
  })
})

describe('registering a policy', () => {
  test('one only, and never for public', () => {
    const policy = { levels: ['members'], headers: ['X-Reader'], identify: () => null, mayRead: () => true }
    assert.throws(() => access.setAccessPolicy({ ...policy, levels: ['public'] }), /public/)
    assert.throws(() => access.setAccessPolicy({ ...policy, levels: ['Bad Level'] }), /lower-case/)
    access.setAccessPolicy(policy)
    try {
      assert.throws(() => access.setAccessPolicy(policy), /already registered/)
    } finally {
      access.clearAccessPolicy()
    }
  })

  test('a policy that throws denies, and its reader is anonymous', async () => {
    access.setAccessPolicy({
      levels: ['members'],
      headers: ['X-Reader'],
      identify: () => { throw new Error('lookup failed') },
      mayRead: () => { throw new Error('broken') }
    })
    try {
      assert.strictEqual(await access.viewerOf({ headers: { 'x-reader': 't' } }), null)
      assert.strictEqual(access.mayRead({ visibility: 'members' }, { id: 1 }), false)
      assert.strictEqual(access.mayRead({ visibility: 'public' }, null), true)
    } finally {
      access.clearAccessPolicy()
    }
  })

  test('only `true` allows', () => {
    access.setAccessPolicy({ levels: ['members'], headers: [], identify: () => null, mayRead: () => 'yes' })
    try {
      assert.strictEqual(access.mayRead({ visibility: 'members' }, { id: 1 }), false)
    } finally {
      access.clearAccessPolicy()
    }
  })
})
