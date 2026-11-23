/**
 * Phase 2: write tokens for the Admin API, post edit locks, and snippets.
 *
 * Most of this runs for real against a scratch SQLite database migrated from
 * db/migrations, because the things worth holding in place here are
 * behaviours — a revoked session refused, a disabled owner's token refused, a
 * token acting with its owner's current role, a lock that two editors cannot
 * both hold. The rest are source checks on wiring a test cannot reach without
 * a running server: which routes take a token, and where the lock is checked.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)

// Before anything touches the database: getDb() connects once and caches it.
const scratch = mkdtempSync(join(tmpdir(), 'basicben-phase2-'))
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'phase-2-test-key-that-is-long-enough-to-sign-with'

let db, auth, apiAuth, session, tokens, PostLock, LOCK_TTL_MS, snippets
const ids = {}
const secrets = {}

function request({ token, method = 'GET', url = '/', body = {}, params = {}, query = {} } = {}) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {}, method, url, body, params, query }
}

function response() {
  return {
    status: 200,
    body: undefined,
    headers: {},
    json(data, status = 200) { this.body = data; this.status = status },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value }
  }
}

/** Run one middleware; report whether it called next and what it answered. */
async function run(middleware, req) {
  const res = response()
  let passed = false
  await middleware(req, res, () => { passed = true })
  return { passed, res, req }
}

async function addUser(name, role, extra = {}) {
  const result = await db.run(
    'INSERT INTO users (name, email, password, role, email_verified, disabled_at) VALUES (?, ?, ?, ?, ?, ?)',
    [name, `${name.toLowerCase()}@example.test`, 'x', role, 1, extra.disabled_at ?? null]
  )
  return Number(result.lastInsertRowid)
}

before(async () => {
  const { createMigrator } = await import('@basicbenframework/core/db/migrator')
    .catch(() => load('node_modules/@basicbenframework/core/src/db/migrator.js'))
  await (await createMigrator()).migrate()

  db = await (await import('@basicbenframework/core/db')).getDb()
  auth = await load('src/middleware/auth.ts')
  apiAuth = await load('src/middleware/api-auth.ts')
  session = await load('src/helpers/session.ts')
  tokens = await import('@basicbenframework/core/auth/api-tokens')
  ;({ PostLock, LOCK_TTL_MS } = await load('src/models/PostLock.ts'))
  snippets = await load('src/controllers/SnippetController.ts')

  ids.admin = await addUser('Admin', 'admin')
  ids.editor = await addUser('Editor', 'editor')
  ids.author = await addUser('Author', 'author')
  ids.other = await addUser('Other', 'author')
  ids.contributor = await addUser('Contributor', 'contributor')
  ids.disabled = await addUser('Gone', 'author')

  secrets.write = (await tokens.createApiToken(ids.author, { name: 'Importer', scopes: ['content:write'] })).token
  secrets.read = (await tokens.createApiToken(ids.author, { name: 'Build', scopes: ['content:read'] })).token
  secrets.media = (await tokens.createApiToken(ids.author, { name: 'Uploader', scopes: ['media:write'] })).token
  secrets.disabled = (await tokens.createApiToken(ids.disabled, { name: 'Orphan', scopes: ['content:write', 'content:read'] })).token
  // Disabled after the token was issued, which is the case that matters.
  await db.run('UPDATE users SET disabled_at = ? WHERE id = ?', [new Date().toISOString(), ids.disabled])

  const post = await db.run(
    'INSERT INTO posts (title, slug, content, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['Locked', 'locked', 'Some content here', ids.author, new Date().toISOString(), new Date().toISOString()]
  )
  ids.post = Number(post.lastInsertRowid)
})

after(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('the content API checks the account, not just the signature', () => {
  test('a current session passes, with the role the account has now', async () => {
    const token = session.issueSessionToken({ id: ids.other, role: 'author', email_verified: 1, token_version: 0 })
    // Promoted after signing in: the JWT still says author.
    await db.run("UPDATE users SET role = 'editor' WHERE id = ?", [ids.other])

    const { passed, req } = await run(apiAuth.requireScope('content:read'), request({ token }))
    await db.run("UPDATE users SET role = 'author' WHERE id = ?", [ids.other])

    assert.ok(passed)
    assert.strictEqual(req.user.role, 'editor', 'the role comes from the row, not the token')
  })

  test('a session ended by "sign out everywhere" is refused', async () => {
    const token = session.issueSessionToken({ id: ids.other, role: 'author', email_verified: 1, token_version: 0 })
    await session.revokeSessions(ids.other)

    const { passed, res, req } = await run(apiAuth.requireScope('content:read'), request({ token }))

    assert.strictEqual(passed, false, 'public reads are off, so a revoked session gets nothing')
    assert.strictEqual(res.status, 401)
    assert.strictEqual(req.user, undefined)
  })

  test("a disabled account's session is refused", async () => {
    const token = session.issueSessionToken({ id: ids.disabled, role: 'author', email_verified: 1, token_version: 0 })
    const { passed, res } = await run(apiAuth.requireScope('content:read'), request({ token }))

    assert.strictEqual(passed, false)
    assert.strictEqual(res.status, 401)
  })

  test("a disabled account's API token is refused", async () => {
    const { passed, res } = await run(apiAuth.requireScope('content:read'), request({ token: secrets.disabled }))

    assert.strictEqual(passed, false)
    assert.strictEqual(res.status, 401)
  })

  test('a live token still works', async () => {
    const { passed, req } = await run(apiAuth.requireScope('content:read'), request({ token: secrets.read }))
    assert.ok(passed)
    assert.strictEqual(req.apiToken.name, 'Build')
  })

  test('one account lookup serves both middlewares', () => {
    const source = read('src/middleware/api-auth.ts')
    assert.match(source, /import \{ resolveSession, accountForToken \} from '\.\/auth\.ts'/)
    assert.doesNotMatch(source, /verifyJwt|payload\.role|email_verified \?\? true/)
  })
})

describe('authOrToken: the Admin API', () => {
  const write = () => apiAuth.authOrToken('content:write')

  test('a content:write token acts as its owner, with the owner\'s current account', async () => {
    const { passed, req, res } = await run(write(), request({ token: secrets.write, method: 'POST', url: '/api/posts' }))

    assert.ok(passed)
    assert.strictEqual(req.userId, ids.author)
    assert.deepStrictEqual(req.user, { id: ids.author, role: 'author', email_verified: true })
    assert.strictEqual(req.apiToken.name, 'Importer')
    assert.ok(res.headers['x-basicben-token-id'], 'the response says which token made the change')
  })

  test('the owner\'s role caps the token: demote the owner and the token is demoted', async () => {
    await db.run("UPDATE users SET role = 'contributor' WHERE id = ?", [ids.author])
    const { req } = await run(write(), request({ token: secrets.write }))
    await db.run("UPDATE users SET role = 'author' WHERE id = ?", [ids.author])

    assert.strictEqual(req.user.role, 'contributor')
  })

  test('a token without the scope is told which scope it lacks', async () => {
    const { passed, res } = await run(write(), request({ token: secrets.read, method: 'POST' }))
    assert.strictEqual(passed, false)
    assert.strictEqual(res.status, 403)
    assert.match(res.body.error, /content:write/)
  })

  test('media:write is its own scope', async () => {
    assert.strictEqual((await run(write(), request({ token: secrets.media, method: 'POST' }))).res.status, 403)
    assert.ok((await run(apiAuth.authOrToken('media:write'), request({ token: secrets.media, method: 'POST' }))).passed)
  })

  test('unknown tokens and disabled owners get the same 401', async () => {
    const unknown = await run(write(), request({ token: 'bb_not-a-real-token', method: 'POST' }))
    const disabled = await run(write(), request({ token: secrets.disabled, method: 'POST' }))

    assert.strictEqual(unknown.res.status, 401)
    assert.strictEqual(disabled.res.status, 401)
    assert.deepStrictEqual(unknown.res.body, disabled.res.body)
  })

  test('a session works exactly as with auth, and a revoked one does not', async () => {
    const good = session.issueSessionToken({ id: ids.editor, role: 'editor', email_verified: 1, token_version: 0 })
    assert.ok((await run(write(), request({ token: good, method: 'PUT' }))).passed)

    const stale = session.issueSessionToken({ id: ids.editor, role: 'editor', email_verified: 1, token_version: 99 })
    assert.strictEqual((await run(write(), request({ token: stale, method: 'PUT' }))).res.status, 401)
  })

  test('no credential is 401', async () => {
    assert.strictEqual((await run(write(), request())).res.status, 401)
  })

  test('token writes are rate limited per token; reads are not counted', async () => {
    const limited = (await tokens.createApiToken(ids.author, { name: 'Runaway', scopes: ['content:write'] })).token
    const quiet = console.info
    console.info = () => {}

    try {
      for (let i = 0; i < 5; i++) {
        assert.ok((await run(write(), request({ token: limited, method: 'GET' }))).passed)
      }

      let last
      for (let i = 0; i < 61; i++) {
        last = await run(write(), request({ token: limited, method: 'PUT', url: '/api/posts/1' }))
      }

      assert.strictEqual(last.res.status, 429)
      assert.ok(last.res.headers['retry-after'])

      // Another token is unaffected.
      assert.ok((await run(write(), request({ token: secrets.write, method: 'PUT' }))).passed)
    } finally {
      console.info = quiet
    }
  })

  test('plain auth still refuses tokens, so everything not opened stays closed', async () => {
    const { passed, res } = await run(auth.auth, request({ token: secrets.write }))
    assert.strictEqual(passed, false)
    assert.strictEqual(res.status, 403)
  })
})

describe('which routes take a token', () => {
  const posts = read('src/routes/api/posts.ts')

  test('posts: list, read, create, update, trash', () => {
    assert.match(posts, /const contentWrite = authOrToken\('content:write'\)/)
    assert.match(posts, /router\.get\('\/api\/posts', contentWrite,/)
    assert.match(posts, /router\.post\('\/api\/posts', contentWrite, requireCapability\('post\.create'\)/)
    assert.match(posts, /router\.get\('\/api\/posts\/:id', contentWrite,/)
    assert.match(posts, /router\.put\('\/api\/posts\/:id', contentWrite,/)
    assert.match(posts, /router\.delete\('\/api\/posts\/:id', contentWrite,/)
  })

  test('bulk, revisions, restore, autosave and locks stay session-only', () => {
    for (const path of ['bulk', ':id/restore', ':id/autosave', ':id/revisions', ':id/revisions/:revisionId/restore']) {
      const line = posts.split('\n').find(l => l.includes(`'/api/posts/${path}'`))
      assert.ok(line, `${path} should be routed`)
      assert.match(line, /, auth, /, `${path} should be on plain auth`)
    }
    assert.match(posts, /router\.post\('\/api\/posts\/:id\/lock', auth, requireSession,/)
  })

  test('tags and categories take content:write in front of their capability', () => {
    for (const file of ['tags', 'categories']) {
      const source = read(`src/routes/api/${file}.ts`)
      assert.doesNotMatch(source, /, auth, /)
      assert.match(source, /authOrToken\('content:write'\), requireCapability\('(tag|category)\.manage'\)/)
    }
  })

  test('media uploads take media:write; deleting media does not', () => {
    const media = read('src/routes/api/media.ts')
    assert.match(media, /router\.post\('\/api\/media\/sign', mediaWrite, requireCapability\('media\.upload'\)/)
    assert.match(media, /router\.post\('\/api\/media\/confirm', mediaWrite, requireCapability\('media\.upload'\)/)
    assert.match(media, /router\.delete\('\/api\/media\/:id', auth,/)
  })

  test('tokens still cannot manage tokens', () => {
    assert.match(read('src/routes/api/tokens.ts'), /router\.post\('\/api\/tokens', auth, requireSession/)
  })

  test('a token can trash but not empty the trash', () => {
    assert.match(read('src/controllers/PostController.ts'), /if \(req\.apiToken && post\.deleted_at\)/)
  })
})

describe('post edit locks', () => {
  test('the first editor gets it; a second is refused and told who', async () => {
    const first = await PostLock.acquire(ids.post, ids.author)
    assert.ok(first.acquired)

    const second = await PostLock.acquire(ids.post, ids.editor)
    assert.strictEqual(second.acquired, false)
    assert.strictEqual(second.lock.user_name, 'Author')

    assert.strictEqual(await PostLock.blocking(ids.post, ids.author), null, 'your own lock never blocks you')
    assert.strictEqual((await PostLock.blocking(ids.post, ids.editor)).user_id, ids.author)
  })

  test('the holder refreshes it on the heartbeat', async () => {
    const before = await PostLock.current(ids.post)
    const later = Date.now() + 1000
    const refreshed = await PostLock.acquire(ids.post, ids.author, { now: later })
    assert.ok(refreshed.acquired)
    assert.ok(new Date(refreshed.lock.locked_at) > new Date(before.locked_at))
  })

  test('take over moves it, and the old holder letting go does not free it', async () => {
    const taken = await PostLock.acquire(ids.post, ids.editor, { takeOver: true })
    assert.ok(taken.acquired)

    await PostLock.release(ids.post, ids.author)
    assert.strictEqual((await PostLock.current(ids.post)).user_id, ids.editor)

    await PostLock.release(ids.post, ids.editor)
    assert.strictEqual(await PostLock.current(ids.post), null)
  })

  test('a stale lock is free for the next person', async () => {
    const start = Date.now()
    await PostLock.acquire(ids.post, ids.author, { now: start })

    const tooSoon = await PostLock.acquire(ids.post, ids.editor, { now: start + LOCK_TTL_MS - 1000 })
    assert.strictEqual(tooSoon.acquired, false)

    const afterExpiry = await PostLock.acquire(ids.post, ids.editor, { now: start + LOCK_TTL_MS + 1000 })
    assert.ok(afterExpiry.acquired)
    await PostLock.release(ids.post, ids.editor)
  })

  test('every write to the text checks the lock', () => {
    const controller = read('src/controllers/PostController.ts')
    const occurrences = controller.match(/const locked = await lockConflict\(req, post\)\n\s+if \(locked\) return res\.json\(locked, 409\)/g) || []
    assert.strictEqual(occurrences.length, 3, 'update, autosave and restoreRevision')
  })

  test('a token can never take over', () => {
    const source = read('src/controllers/PostLockController.ts')
    assert.match(source, /const takeOver = !req\.apiToken && /)
  })

  test('locks live in their own table, out of every SELECT posts.*', () => {
    assert.match(read('db/migrations/031_create_post_locks.js'), /CREATE TABLE post_locks/)
    assert.doesNotMatch(read('db/migrations/031_create_post_locks.js'), /ALTER TABLE posts/)
  })

  test('the editor heartbeats, offers a take-over, and lets go with keepalive', () => {
    const hook = read('src/client/hooks/usePostLock.ts')
    const editor = read('src/client/pages/admin/PostEditor.tsx')
    assert.match(hook, /keepalive: true/)
    assert.match(hook, /take_over: true/)
    assert.match(editor, /usePostLock\(postId, !isPage && isEditing\)/)
    assert.match(editor, /Take over/)
  })
})

describe('snippets', () => {
  const user = (id, role) => ({ id, role, email_verified: true })
  const call = async (method, { as, body = {}, params = {} }) => {
    const res = response()
    await snippets.SnippetController[method]({ user: as, userId: as.id, body, params, query: {}, headers: {} }, res)
    return res
  }

  test('authors and up may use them; contributors may not', () => {
    assert.ok(snippets.mayUseSnippets(user(ids.author, 'author')))
    assert.ok(snippets.mayUseSnippets(user(ids.editor, 'editor')))
    assert.strictEqual(snippets.mayUseSnippets(user(ids.contributor, 'contributor')), false)
    assert.strictEqual(snippets.mayUseSnippets({ ...user(ids.author, 'author'), email_verified: false }), false)
  })

  test('create, list, and the edit rule: your own, or anyone\'s for an editor', async () => {
    const author = user(ids.author, 'author')
    const other = user(ids.other, 'author')
    const editor = user(ids.editor, 'editor')

    const created = await call('store', { as: author, body: { name: 'Disclosure', content: 'Links may be affiliate links.' } })
    assert.strictEqual(created.status, 201)
    const id = created.body.snippet.id
    assert.strictEqual(created.body.snippet.created_by, ids.author)

    const listed = await call('index', { as: other })
    const row = listed.body.snippets.find(s => s.id === id)
    assert.ok(row, 'the library is shared')
    assert.strictEqual(row.can_edit, false)

    assert.strictEqual((await call('update', { as: other, params: { id: String(id) }, body: { name: 'Mine now' } })).status, 403)
    assert.strictEqual((await call('destroy', { as: other, params: { id: String(id) } })).status, 403)

    const edited = await call('update', { as: editor, params: { id: String(id) }, body: { content: 'Edited by an editor.' } })
    assert.strictEqual(edited.status, 200)
    assert.strictEqual(edited.body.snippet.content, 'Edited by an editor.')
    assert.strictEqual(edited.body.snippet.name, 'Disclosure', 'absent fields are left alone')

    assert.strictEqual((await call('destroy', { as: author, params: { id: String(id) } })).status, 200)
    assert.strictEqual((await call('show', { as: author, params: { id: String(id) } })).status, 404)
  })

  test('a contributor is refused, and bad input is a 422', async () => {
    assert.strictEqual((await call('index', { as: user(ids.contributor, 'contributor') })).status, 403)
    assert.strictEqual((await call('store', { as: user(ids.author, 'author'), body: { name: ' ', content: '' } })).status, 422)
  })

  test('the editor can insert one at the caret', () => {
    assert.match(read('src/client/components/MarkdownEditor.tsx'), /tools\?\.\(insertAtCursor,/)
    assert.match(read('src/client/pages/admin/PostEditor.tsx'), /<SnippetPicker onInsert=\{insert\}/)
  })
})
