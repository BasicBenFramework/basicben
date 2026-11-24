/**
 * The members feature: members, members-only posts, and newsletters.
 *
 * Runs for real against a scratch SQLite database migrated from
 * db/migrations, because what matters here is behaviour: a member session
 * refused by every admin check, a magic link that works once, a gated body
 * that never reaches an anonymous reader or a shared cache, and a newsletter
 * that reaches each member exactly once however many times it is queued or
 * processed. Controllers are driven with plain request/response objects, as
 * phase2-api-editing does.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const FEATURE = 'src/features/members'
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)

const scratch = mkdtempSync(join(tmpdir(), 'basicben-phase3-'))
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'phase-3-test-key-that-is-long-enough-to-sign-with'
process.env.APP_URL = 'https://cms.example.test'
process.env.SITE_URL = 'https://blog.example.test'

let db, hooks, HOOKS, auth, session, memberAuth, memberMw, MemberController, MemberAdminController
let Member, PublicContent, cacheable, FeedController, newsletter, gating, csv, siteSettings, PostController

/** Every mail the app tried to send, captured and cancelled. */
const outbox = []

function request({ headers = {}, method = 'GET', url = '/', body = {}, params = {}, query = {}, ...rest } = {}) {
  return { headers, method, url, body, params, query, socket: { remoteAddress: '192.0.2.10' }, ...rest }
}

function response() {
  return {
    status: 200,
    statusCode: 200,
    body: undefined,
    text: undefined,
    headers: {},
    json(data, status = 200) { this.body = data; this.status = status },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    status_(code) { this.status = code; return this },
    end(text) { this.text = text },
    send(text) { this.text = text }
  }
}

// `res.status(code).send(html)` — the bare pages use it.
function pageResponse() {
  const res = response()
  res.status = 200
  const json = res.json
  return Object.assign(res, {
    json,
    status(code) { res.code = code; return res }
  })
}

async function run(handler, req, res = response()) {
  let passed = false
  await handler(req, res, () => { passed = true })
  return { passed, res, req }
}

async function addUser(name, role) {
  const result = await db.run(
    'INSERT INTO users (name, email, password, role, email_verified) VALUES (?, ?, ?, ?, ?)',
    [name, `${name.toLowerCase()}@example.test`, 'x', role, 1]
  )
  return Number(result.lastInsertRowid)
}

async function addPost(userId, { title, visibility = 'public', content = 'The whole body of the post.', html = '<p>The whole body of the post.</p>', published = 1, send_newsletter = 0 }) {
  const now = new Date(Date.now() - 1000).toISOString()
  const result = await db.run(
    `INSERT INTO posts (title, slug, content, content_html, excerpt, user_id, published, status, publish_at, visibility, send_newsletter, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, title.toLowerCase().replace(/\W+/g, '-'), content, html, `Excerpt of ${title}`, userId, published,
      published ? 'published' : 'draft', now, visibility, send_newsletter, now, now]
  )
  return Number(result.lastInsertRowid)
}

/** The token in the most recent magic-link mail to an address. */
function lastLinkTo(email) {
  const mail = [...outbox].reverse().find(m => m.to === email)
  const match = mail?.text?.match(/token=([A-Za-z0-9_-]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

const ids = {}

before(async () => {
  const { createMigrator } = await import('@basicbenframework/core/db/migrator')
    .catch(() => load('node_modules/@basicbenframework/core/src/db/migrator.js'))
  await (await createMigrator()).migrate()

  db = await (await import('@basicbenframework/core/db')).getDb()
  ;({ hooks, HOOKS } = await import('@basicbenframework/core/hooks'))

  hooks.on(HOOKS.MAIL_SENDING, (message) => {
    outbox.push(message)
    return { ...message, cancelled: true }
  }, { name: 'test:outbox' })

  auth = await load('src/middleware/auth.ts')
  session = await load('src/helpers/session.ts')
  // Registered through the real host, as the server does: the settings, the
  // access policy, the newsletter listeners and the cron tasks.
  await (await load('src/host/index.ts')).registerFeatures([(await load(`${FEATURE}/index.ts`)).default])

  memberAuth = await load(`${FEATURE}/session.ts`)
  memberMw = await load(`${FEATURE}/middleware.ts`)
  ;({ MemberController } = await load(`${FEATURE}/MemberController.ts`))
  ;({ MemberAdminController } = await load(`${FEATURE}/MemberAdminController.ts`))
  ;({ Member } = await load(`${FEATURE}/Member.ts`))
  ;({ PublicContent } = await load('src/models/PublicContent.ts'))
  ;({ cacheable } = await load('src/middleware/cache.ts'))
  ;({ FeedController } = await load('src/controllers/FeedController.ts'))
  ;({ PostController } = await load('src/controllers/PostController.ts'))
  newsletter = await load(`${FEATURE}/newsletter.ts`)
  gating = await load('src/helpers/gating.ts')
  csv = await load(`${FEATURE}/csv.ts`)
  siteSettings = await load('src/helpers/site-settings.ts')

  ids.admin = await addUser('Admin', 'admin')
  ids.author = await addUser('Author', 'author')
  ids.editor = await addUser('Editor', 'editor')
})

after(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('the migrations', () => {
  test('create the members, token and newsletter tables, and the post columns', async () => {
    for (const table of ['members', 'member_tokens', 'newsletter_sends', 'newsletter_queue']) {
      assert.ok(await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]), `${table} exists`)
    }
    const columns = (await db.all('PRAGMA table_info(posts)')).map(c => c.name)
    assert.ok(columns.includes('visibility'))
    assert.ok(columns.includes('send_newsletter'))
  })

  test('are numbered 033 to 035 and portable', () => {
    for (const file of ['033_create_members.js', '034_add_post_visibility.js', '035_create_newsletters.js']) {
      const source = read(`db/migrations/${file}`)
      // The portable spellings, not SQLite's.
      assert.doesNotMatch(source, /AUTOINCREMENT|DATETIME/)
    }
  })
})

describe('a member session is never an admin session', () => {
  test('admin `auth` refuses a member token', async () => {
    const member = await Member.create({ email: 'reader@example.test', source: 'admin' })
    const token = memberAuth.issueMemberSession(member)

    const { passed, res, req } = await run(auth.auth, request({ headers: { authorization: `Bearer ${token}` } }))

    assert.strictEqual(passed, false)
    assert.strictEqual(res.status, 401)
    assert.strictEqual(req.user, undefined)
    assert.strictEqual(req.userId, undefined)

    const resolved = await auth.resolveSession(token)
    assert.strictEqual(resolved.ok, false)
  })

  test('even a member whose id matches an admin user id', async () => {
    // Member ids and user ids are separate sequences; collide them on purpose.
    const token = memberAuth.issueMemberSession({ id: ids.admin, session_version: 0 })
    const { passed } = await run(auth.auth, request({ headers: { authorization: `Bearer ${token}` } }))
    assert.strictEqual(passed, false)
  })

  test('and an admin session is not a member session', async () => {
    const adminToken = session.issueSessionToken({ id: ids.admin, role: 'admin', email_verified: 1, token_version: 0 })
    assert.strictEqual(memberAuth.readMemberSession(adminToken), null)
    assert.strictEqual(await memberMw.resolveMember(adminToken), null)

    const { passed, res } = await run(memberMw.requireMember, request({ headers: { 'x-member-token': adminToken } }))
    assert.strictEqual(passed, false)
    assert.strictEqual(res.status, 401)
  })

  test('the member middleware never sets the admin principal', () => {
    const source = read(`${FEATURE}/middleware.ts`).replace(/\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(source, /req\.user\s*=|req\.userId\s*=/)
  })

  test('the session is not signed with APP_KEY itself', () => {
    const source = read(`${FEATURE}/session.ts`)
    assert.match(source, /createHmac\('sha256', appKey\(/)
    assert.doesNotMatch(source, /signJwt\([^)]*process\.env\.APP_KEY/)
  })
})

describe('magic links', () => {
  const ask = (body, headers = {}) => run(MemberController.magicLink, request({ method: 'POST', body, headers }))

  test('sign-up: one uniform answer, a link that works once, then a session', async () => {
    const { res } = await ask({ email: 'New.Reader@Example.test', name: 'New Reader' })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.message, MemberController && (await load(`${FEATURE}/MemberController.ts`)).MAGIC_LINK_SENT)

    // Nobody is created until the link is followed.
    assert.strictEqual(await Member.findByEmail('new.reader@example.test'), undefined)

    const token = lastLinkTo('new.reader@example.test')
    assert.ok(token, 'the mail carries a link')
    assert.match(outbox.at(-1).text, /^https:\/\/blog\.example\.test\/members\/verify\?token=/m, 'to the front end, not the API')

    const first = await run(MemberController.verify, request({ method: 'POST', body: { token } }))
    assert.strictEqual(first.res.status, 200)
    assert.ok(first.res.body.token)
    assert.strictEqual(first.res.body.member.email, 'new.reader@example.test')
    assert.strictEqual(first.res.body.member.name, 'New Reader')
    assert.strictEqual(first.res.body.member.newsletter, true)
    assert.strictEqual(first.res.body.member.email_verified, true)
    assert.strictEqual(first.res.headers['cache-control'], 'no-store')

    const again = await run(MemberController.verify, request({ method: 'POST', body: { token } }))
    assert.strictEqual(again.res.status, 400, 'single use')

    ids.readerToken = first.res.body.token
  })

  test('the link goes to the configured page, never one the caller names', async () => {
    await db.run("INSERT INTO settings (key, value, group_name) VALUES ('members_signin_url', 'https://front.example.test/auth', 'members')")
    await ask({ email: 'redirect@example.test', redirect: 'https://evil.example/steal', url: 'https://evil.example' })
    const mail = outbox.at(-1)
    assert.match(mail.text, /https:\/\/front\.example\.test\/auth\?token=/)
    assert.doesNotMatch(mail.text + mail.html, /evil\.example/)
    await db.run("DELETE FROM settings WHERE key = 'members_signin_url'")
  })

  test('invite-only: a stranger gets the same answer and no mail; a member gets a link', async () => {
    await db.run("INSERT INTO settings (key, value, group_name) VALUES ('members_signup', 'invite', 'members')")
    const before = outbox.length

    const stranger = await ask({ email: 'stranger@example.test' })
    assert.strictEqual(stranger.res.status, 200)
    assert.strictEqual(outbox.length, before, 'nothing sent')
    assert.ok(!(await db.get("SELECT id FROM member_tokens WHERE email = 'stranger@example.test'")))

    await Member.create({ email: 'invited@example.test', source: 'admin' })
    const invited = await ask({ email: 'invited@example.test' })
    assert.deepStrictEqual(invited.res.body, stranger.res.body, 'indistinguishable')
    assert.ok(lastLinkTo('invited@example.test'))

    await db.run("DELETE FROM settings WHERE key = 'members_signup'")
  })

  test('closed: no links for anyone, same answer', async () => {
    await db.run("INSERT INTO settings (key, value, group_name) VALUES ('members_signup', 'closed', 'members')")
    const before = outbox.length
    const { res } = await ask({ email: 'reader@example.test' })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(outbox.length, before)
    await db.run("DELETE FROM settings WHERE key = 'members_signup'")
  })

  test('the per-mailbox limit is silent: still 200, no further mail', async () => {
    const email = 'limited@example.test'
    for (let i = 0; i < 3; i++) await ask({ email })
    const before = outbox.length
    const { res } = await ask({ email })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(outbox.length, before)
  })

  test('only the newest link works', async () => {
    await Member.create({ email: 'twice@example.test', source: 'admin' })
    await ask({ email: 'twice@example.test' })
    const older = lastLinkTo('twice@example.test')
    await ask({ email: 'twice@example.test' })
    const newer = lastLinkTo('twice@example.test')
    assert.notStrictEqual(older, newer)

    assert.strictEqual((await run(MemberController.verify, request({ body: { token: older } }))).res.status, 400)
    assert.strictEqual((await run(MemberController.verify, request({ query: { token: newer } }))).res.status, 200, 'GET ?token= works too')
  })

  test('a malformed address is refused for what it is', async () => {
    const { res } = await ask({ email: 'not-an-address' })
    assert.strictEqual(res.status, 422)
  })

  test('the address limit is its own namespace', () => {
    assert.match(read(`${FEATURE}/rate-limits.ts`), /key: addressIn\('member-magic-link'\)/)
    assert.match(read(`${FEATURE}/routes.ts`), /'\/api\/v1\/members\/magic-link', memberMagicLinkLimit/)
  })
})

describe('the member endpoints', () => {
  test('me, update and sign out, with X-Member-Token or a bearer header', async () => {
    const headers = { 'x-member-token': ids.readerToken }

    const me = await run(memberMw.requireMember, request({ headers }))
    assert.ok(me.passed)
    const meRes = response()
    await MemberController.me(me.req, meRes)
    assert.strictEqual(meRes.body.member.email, 'new.reader@example.test')
    assert.strictEqual(meRes.body.member.session_version, undefined, 'no internals')

    // A browser may use the ordinary bearer header for the member endpoints.
    const bearer = await run(memberMw.requireMember, request({ headers: { authorization: `Bearer ${ids.readerToken}` } }))
    assert.ok(bearer.passed)

    const upd = response()
    await MemberController.update(request({ headers, body: { name: '  Renamed\r\n ', newsletter: false }, member: me.req.member }), upd)
    assert.strictEqual(upd.body.member.name, 'Renamed')
    assert.strictEqual(upd.body.member.newsletter, false)

    const bad = response()
    await MemberController.update(request({ body: { newsletter: 'yes' }, member: me.req.member }), bad)
    assert.strictEqual(bad.status, 422)

    await MemberController.update(request({ body: { newsletter: true }, member: me.req.member }), response())

    await MemberController.signout(request({ member: me.req.member }), response())
    const after = await run(memberMw.requireMember, request({ headers }))
    assert.strictEqual(after.passed, false, 'signed out everywhere')
  })

  test('a deleted member is signed out', async () => {
    const member = await Member.create({ email: 'leaver@example.test' })
    const token = memberAuth.issueMemberSession(member)
    await Member.delete(member.id)
    assert.strictEqual(await memberMw.resolveMember(token), null)
  })
})

describe('members-only posts', () => {
  before(async () => {
    ids.publicPost = await addPost(ids.author, { title: 'Open Post' })
    ids.gatedPost = await addPost(ids.author, { title: 'Members Post', visibility: 'members', content: 'SECRET body', html: '<p>SECRET body</p>' })
    ids.paidPost = await addPost(ids.author, { title: 'Paid Post', visibility: 'paid', content: 'PAID body', html: '<p>PAID body</p>' })
    const reader = await Member.create({ email: 'gated-reader@example.test' })
    ids.gatedReaderToken = memberAuth.issueMemberSession(reader)
  })

  test('are listed, with their body withheld from anonymous readers', async () => {
    const { posts } = await PublicContent.posts({ perPage: 50 })
    const gated = posts.find(p => p.id === ids.gatedPost)
    const paid = posts.find(p => p.id === ids.paidPost)
    const open = posts.find(p => p.id === ids.publicPost)

    assert.ok(gated, 'still listed')
    assert.strictEqual(gated.content, null)
    assert.strictEqual(gated.gated, true)
    assert.strictEqual(gated.visibility, 'members')
    assert.strictEqual(gated.title, 'Members Post')
    // The automatic excerpt of a two-word post is the whole post, so it goes too.
    assert.strictEqual(gated.excerpt, null)
    assert.doesNotMatch(JSON.stringify(gated), /SECRET/)

    assert.strictEqual(paid.content, null, 'paid is treated as members for now')
    assert.strictEqual(paid.visibility, 'paid')

    assert.strictEqual(open.gated, false)
    assert.match(open.content, /whole body/)

    assert.doesNotMatch(JSON.stringify(posts), /SECRET|PAID body/)

    const single = await PublicContent.post(String(ids.gatedPost), 'markdown')
    assert.strictEqual(single.content, null, 'in either format')
  })

  test('and given to members', async () => {
    const viewer = await memberMw.resolveMember(ids.gatedReaderToken)
    assert.ok(viewer)
    const { posts } = await PublicContent.posts({ perPage: 50, viewer })
    const gated = posts.find(p => p.id === ids.gatedPost)
    assert.strictEqual(gated.gated, false)
    assert.match(gated.content, /SECRET body/)
  })

  test('through the controller, the session comes from X-Member-Token beside the content token', async () => {
    const { PublicApiController } = await load('src/controllers/PublicApiController.ts')
    const { identifyViewer } = await load('src/middleware/viewer.ts')
    const req = request({ headers: { authorization: 'Bearer bb_sitetoken', 'x-member-token': ids.gatedReaderToken }, params: { slug: String(ids.gatedPost) } })
    await run(identifyViewer, req)
    assert.ok(req.member, 'the policy identified the member')
    const res = response()
    await PublicApiController.post(req, res)
    assert.match(res.body.data.content, /SECRET body/)

    const anon = request({ headers: { 'x-member-token': 'forged.token.value' }, params: { slug: String(ids.gatedPost) } })
    await run(identifyViewer, anon)
    const anonRes = response()
    await PublicApiController.post(anon, anonRes)
    assert.strictEqual(anonRes.body.data.content, null, 'a bad token is no token')
  })

  test('a response with a member session is private and varies on it', async () => {
    const withMember = response()
    await run(cacheable, request({ headers: { 'x-member-token': ids.gatedReaderToken } }), withMember)
    withMember.json({ ok: true })
    assert.match(withMember.headers['cache-control'], /^private/)
    assert.match(withMember.headers.vary, /X-Member-Token/)
    assert.match(withMember.headers.vary, /Authorization/)

    const anonymous = response()
    await run(cacheable, request(), anonymous)
    anonymous.json({ ok: true })
    assert.match(anonymous.headers['cache-control'], /^public/)
    assert.match(anonymous.headers.vary, /X-Member-Token/, 'a cache keyed on headers never crosses the two')
  })

  test('the policy is this feature, offering members and paid, keyed on X-Member-Token', async () => {
    const access = await load('src/helpers/access.ts')
    assert.deepStrictEqual(access.accessLevels(), ['public', 'members', 'paid'])
    assert.deepStrictEqual(access.credentialHeaders(), ['X-Member-Token'])
  })

  test('cross-origin front ends may send the header', () => {
    assert.match(read('site/basicben.config.js'), /allowedHeaders: \[[^\]]*'X-Member-Token'/)
  })

  test('feeds carry the excerpt and a link, never the body', async () => {
    const rss = response()
    await FeedController.rss(request({ headers: { host: 'x' } }), rss)
    assert.match(rss.text, /Members Post/)
    assert.doesNotMatch(rss.text, /SECRET body|PAID body/)
    assert.match(rss.text, /This post is for members/)

    const json = response()
    await FeedController.json(request({ headers: { host: 'x' } }), json)
    const item = json.body.items.find(i => i.title === 'Members Post')
    assert.ok(item)
    assert.doesNotMatch(JSON.stringify(json.body), /SECRET body|PAID body/)
  })

  test('the built-in blog feed withholds it too, both columns', async () => {
    const res = response()
    await PostController.feed(request(), res)
    const gated = res.body.posts.find(p => p.id === ids.gatedPost)
    assert.strictEqual(gated.content, null)
    assert.strictEqual(gated.content_html, null)
    assert.strictEqual(gated.gated, true)

    const one = response()
    await PostController.feedShow(request({ params: { id: String(ids.gatedPost) }, headers: { 'x-member-token': ids.gatedReaderToken } }), one)
    assert.match(one.body.post.content_html, /SECRET body/)
  })

  test('the gating rule', () => {
    assert.strictEqual(gating.isGated('public'), false)
    assert.strictEqual(gating.isGated(null), false)
    assert.strictEqual(gating.isGated('members'), true)
    assert.strictEqual(gating.isGated('paid'), true)
    assert.strictEqual(gating.mayReadBody('members', { id: 1 }), true)
    assert.strictEqual(gating.mayReadBody('members', null), false)
    // A level no policy offers is withheld from everyone, members included.
    assert.strictEqual(gating.mayReadBody('nonsense', { id: 1 }), false)
    assert.doesNotMatch(gating.gatedFeedHtml('<b>x</b>', 'https://a/b"c'), /<b>|b"c/)
  })

  // An automatic excerpt of a short post is the whole post.
  test('a gated post never publishes an excerpt that is its whole body', () => {
    const body = 'The secret body of a gated post.'
    assert.strictEqual(gating.publicExcerpt(body, body, 'members', null), null)
    assert.strictEqual(gating.publicExcerpt(body, body, 'members', { id: 1 }), body)
    assert.strictEqual(gating.publicExcerpt(body, body, 'public', null), body)
    const long = 'word '.repeat(100)
    assert.strictEqual(gating.publicExcerpt('word word word…', long, 'members', null), 'word word word…')

    const row = gating.withholdBody({ visibility: 'members', excerpt: body, content: body, content_html: `<p>${body}</p>` }, null)
    assert.strictEqual(row.excerpt, null)
    assert.strictEqual(row.content_html, null)
  })
})

describe('the editor fields', () => {
  test('visibility is validated, and only an editor may ask for a newsletter', async () => {
    const asUser = (id, role, body) => request({ method: 'POST', body, userId: id, user: { id, role, email_verified: true } })

    const bad = response()
    await PostController.store(asUser(ids.editor, 'editor', { title: 'Bad visibility', content: 'Long enough content', visibility: 'secret' }), bad)
    assert.strictEqual(bad.status, 422)

    const author = response()
    await PostController.store(asUser(ids.author, 'author', { title: 'Author send', content: 'Long enough content', send_newsletter: true }), author)
    assert.strictEqual(author.status, 403)

    const editor = response()
    await PostController.store(asUser(ids.editor, 'editor', { title: 'Editor draft', content: 'Long enough content', visibility: 'members', send_newsletter: true }), editor)
    assert.strictEqual(editor.status, 201)
    const row = await db.get('SELECT visibility, send_newsletter FROM posts WHERE id = ?', [editor.body.post.id])
    assert.strictEqual(row.visibility, 'members')
    assert.strictEqual(Number(row.send_newsletter), 1)
  })
})

describe('newsletters', () => {
  before(async () => {
    // A fresh list: three subscribed, one not.
    await db.run('DELETE FROM members')
    ids.subs = []
    for (const email of ['a@sub.test', 'b@sub.test', 'c@sub.test']) ids.subs.push((await Member.create({ email })).id)
    ids.unsub = (await Member.create({ email: 'u@sub.test', status: 'unsubscribed' })).id

    ids.letter = await addPost(ids.editor, {
      title: 'Weekly Letter',
      send_newsletter: 1,
      html: '<p>Hello <a href="/blog/other">other</a> <img src="/uploads/pic.png" alt=""> <a href="https://x.test/abs">abs</a></p><script>alert(1)</script>'
    })
  })

  test('nothing is queued for a post that did not ask, or is not live', async () => {
    const quiet = await addPost(ids.editor, { title: 'Quiet', send_newsletter: 0 })
    assert.strictEqual(await newsletter.queueNewsletterFor(quiet), null)

    const draft = await addPost(ids.editor, { title: 'Draft letter', send_newsletter: 1, published: 0 })
    assert.strictEqual(await newsletter.queueNewsletterFor(draft), null)
    assert.ok(!(await db.get('SELECT id FROM newsletter_sends WHERE post_id IN (?, ?)', [quiet, draft])))
  })

  test('queues every subscribed member, once, however often it is asked', async () => {
    const send = await newsletter.queueNewsletterFor(ids.letter)
    assert.strictEqual(send.status, 'sending')
    assert.strictEqual(send.total_count, 3, 'the unsubscribed member is not queued')

    await newsletter.queueNewsletterFor(ids.letter)
    await newsletter.queueNewsletterFor(ids.letter)
    const rows = await db.all('SELECT member_id FROM newsletter_queue WHERE send_id = ?', [send.id])
    assert.strictEqual(rows.length, 3)
    assert.strictEqual((await db.all('SELECT id FROM newsletter_sends WHERE post_id = ?', [ids.letter])).length, 1)

    ids.send = send.id
  })

  test('the database refuses a second row for the same member or post', async () => {
    await assert.rejects(async () => db.run(
      "INSERT INTO newsletter_queue (send_id, member_id, email, status) VALUES (?, ?, 'dup@x.test', 'pending')",
      [ids.send, ids.subs[0]]
    ))
    await assert.rejects(async () => db.run("INSERT INTO newsletter_sends (post_id, status) VALUES (?, 'preparing')", [ids.letter]))
  })

  test('sends in resumable batches, with one-click unsubscribe and absolute, sanitized content', async () => {
    const sent = []
    const transport = async (message) => { sent.push(message) }

    const first = await newsletter.processNewsletterQueue(2, { send: transport })
    assert.strictEqual(first.sent, 2)
    let send = await newsletter.newsletterFor(ids.letter)
    assert.strictEqual(send.status, 'sending')
    assert.strictEqual(send.sent_count, 2)

    const second = await newsletter.processNewsletterQueue(2, { send: transport })
    assert.strictEqual(second.sent, 1)
    send = await newsletter.newsletterFor(ids.letter)
    assert.strictEqual(send.status, 'sent')
    assert.ok(send.completed_at)

    const third = await newsletter.processNewsletterQueue(10, { send: transport })
    assert.strictEqual(third.sent, 0, 'nothing is sent twice')
    assert.deepStrictEqual(sent.map(m => m.to).sort(), ['a@sub.test', 'b@sub.test', 'c@sub.test'])

    const mail = sent[0]
    assert.strictEqual(mail.subject, 'Weekly Letter')
    assert.match(mail.headers['List-Unsubscribe'], /^<https:\/\/cms\.example\.test\/api\/v1\/members\/unsubscribe\?token=/)
    assert.strictEqual(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
    assert.match(mail.html, /href="https:\/\/blog\.example\.test\/blog\/other"/)
    assert.match(mail.html, /src="https:\/\/cms\.example\.test\/uploads\/pic\.png"/)
    assert.match(mail.html, /href="https:\/\/x\.test\/abs"/)
    assert.doesNotMatch(mail.html, /<script/)
    assert.match(mail.text, /unsubscribe\?token=/)
  })

  test('the unsubscribe link works without an account, and only by POST', async () => {
    const mailToken = memberAuth.issueMemberUnsubscribeToken(ids.subs[0])

    const page = pageResponse()
    await MemberController.unsubscribePage(request({ query: { token: mailToken } }), page)
    assert.strictEqual((await Member.find(ids.subs[0])).status, 'active', 'GET changes nothing')
    assert.match(page.text, /method="post"/)

    const done = pageResponse()
    await MemberController.unsubscribe(request({ method: 'POST', query: { token: mailToken }, body: { 'List-Unsubscribe': 'One-Click' } }), done)
    assert.strictEqual((await Member.find(ids.subs[0])).status, 'unsubscribed')
    assert.strictEqual(done.headers['cache-control'], 'no-store')

    const forged = pageResponse()
    await MemberController.unsubscribe(request({ query: { token: 'nope' } }), forged)
    assert.strictEqual(forged.code, 400)

    // A session is not an unsubscribe token, or the reverse.
    assert.strictEqual(memberAuth.readMemberUnsubscribeToken(memberAuth.issueMemberSession({ id: ids.subs[1] })), null)
    assert.strictEqual(memberAuth.readMemberSession(mailToken), null)
  })

  test('retries a provider error, then gives up; skips the unsubscribed', async () => {
    const post = await addPost(ids.editor, { title: 'Second Letter', send_newsletter: 1 })
    const send = await newsletter.queueNewsletterFor(post)
    // subs[0] unsubscribed above, so two are queued.
    assert.strictEqual(send.total_count, 2)

    // One more unsubscribes after the queue was built.
    await Member.update(ids.subs[1], { status: 'unsubscribed' })

    const failing = async () => { throw new Error('provider down') }
    for (let i = 0; i < newsletter.MAX_ATTEMPTS + 1; i++) await newsletter.processNewsletterQueue(10, { send: failing })

    const rows = await db.all('SELECT member_id, status, attempts, error FROM newsletter_queue WHERE send_id = ? ORDER BY member_id', [send.id])
    const skipped = rows.find(r => r.member_id === ids.subs[1])
    const failed = rows.find(r => r.member_id === ids.subs[2])
    assert.strictEqual(skipped.status, 'skipped')
    assert.strictEqual(failed.status, 'failed')
    assert.strictEqual(Number(failed.attempts), newsletter.MAX_ATTEMPTS)
    assert.match(failed.error, /provider down/)

    const final = await newsletter.newsletterFor(post)
    assert.strictEqual(final.status, 'sent', 'closed: nothing left to try')
    assert.strictEqual(final.failed_count, 1)
    assert.strictEqual(final.skipped_count, 1)
  })

  test('an interrupted send is marked failed, never retried', async () => {
    await Member.update(ids.subs[1], { status: 'active' })
    const post = await addPost(ids.editor, { title: 'Third Letter', send_newsletter: 1 })
    const send = await newsletter.queueNewsletterFor(post)
    const stale = new Date(Date.now() - newsletter.STALE_CLAIM_MS - 1000).toISOString()
    await db.run("UPDATE newsletter_queue SET status = 'sending', claimed_at = ?, attempts = 1 WHERE send_id = ?", [stale, send.id])

    const sent = []
    await newsletter.processNewsletterQueue(10, { send: async (m) => sent.push(m) })
    assert.strictEqual(sent.length, 0)
    const rows = await db.all('SELECT status FROM newsletter_queue WHERE send_id = ?', [send.id])
    assert.ok(rows.every(r => r.status === 'failed'))
  })

  test('two processors at once still send each mail once', async () => {
    const post = await addPost(ids.editor, { title: 'Fourth Letter', send_newsletter: 1 })
    await newsletter.queueNewsletterFor(post)
    const sent = []
    const slow = async (m) => { await new Promise(r => setTimeout(r, 5)); sent.push(m.to) }
    await Promise.all([
      newsletter.processNewsletterQueue(10, { send: slow }),
      newsletter.processNewsletterQueue(10, { send: slow })
    ])
    assert.strictEqual(new Set(sent).size, sent.length, 'no address twice')
  })

  test('the cron endpoint needs CRON_SECRET', async () => {
    delete process.env.CRON_SECRET
    const off = response()
    await newsletter.newslettersCronEndpoint(request({ headers: { authorization: 'Bearer anything' } }), off)
    assert.strictEqual(off.status, 404)

    process.env.CRON_SECRET = 'cron-secret'
    const wrong = response()
    await newsletter.newslettersCronEndpoint(request({ headers: { authorization: 'Bearer nope' } }), wrong)
    assert.strictEqual(wrong.status, 404)

    const right = response()
    await newsletter.newslettersCronEndpoint(request({ headers: { authorization: 'Bearer cron-secret' } }), right)
    assert.strictEqual(right.status, 200)
    assert.ok('sent' in right.body)
    delete process.env.CRON_SECRET

    assert.match(read(`${FEATURE}/routes.ts`), /'\/api\/cron\/newsletters', newslettersCronEndpoint/)
  })

  test('a test send goes to the signed-in account only, and is limited', async () => {
    const post = await addPost(ids.editor, { title: 'Preview Letter', published: 0 })
    const before = outbox.length
    const res = response()
    await MemberAdminController.test(request({ userId: ids.editor, resource: { id: post }, body: { to: 'someone@else.test' } }), res)
    assert.strictEqual(res.status, 200)
    const mail = outbox.at(-1)
    assert.strictEqual(outbox.length, before + 1)
    assert.strictEqual(mail.to, 'editor@example.test')
    assert.match(mail.subject, /^\[Test\]/)
    assert.ok(!(await newsletter.newsletterFor(post)), 'a test is not a send')
  })

  test('last: the post.updated listener queues it when a scheduled post goes live', async () => {
    const later = await addPost(ids.editor, { title: 'Scheduled letter', send_newsletter: 1 })
    await hooks.fire(HOOKS.POST_UPDATED, { post: { id: later }, scheduled: true })
    const send = await newsletter.newsletterFor(later)
    assert.ok(send, 'queued by the listener')
    assert.ok(send.total_count > 0)
  })
})

describe('the admin member list', () => {
  const admin = (extra = {}) => request({ userId: ids.admin, user: { id: ids.admin, role: 'admin', email_verified: true }, ...extra })

  test('add, search, count, update, delete', async () => {
    const created = response()
    await MemberAdminController.store(admin({ body: { email: 'Admin.Added@Example.test', name: 'Added', labels: 'vip, vip, beta', newsletter: true } }), created)
    assert.strictEqual(created.status, 201)
    assert.strictEqual(created.body.member.email, 'admin.added@example.test')
    assert.strictEqual(created.body.member.labels, 'vip, beta')
    assert.strictEqual(created.body.member.source, 'admin')
    assert.strictEqual(created.body.member.session_version, undefined)

    const dup = response()
    await MemberAdminController.store(admin({ body: { email: 'admin.added@example.test' } }), dup)
    assert.strictEqual(dup.status, 422)

    const list = response()
    await MemberAdminController.index(admin({ query: { search: 'vip' } }), list)
    assert.strictEqual(list.body.members.length, 1)
    assert.ok(list.body.counts.total >= 1)
    assert.ok('active' in list.body.counts && 'unsubscribed' in list.body.counts)

    const id = created.body.member.id
    const upd = response()
    await MemberAdminController.update(admin({ params: { id: String(id) }, body: { newsletter: false } }), upd)
    assert.strictEqual(upd.body.member.status, 'unsubscribed')

    const del = response()
    await MemberAdminController.destroy(admin({ params: { id: String(id) } }), del)
    assert.strictEqual(del.status, 200)
    assert.strictEqual(await Member.find(id), undefined)
  })

  test('CSV import skips existing members and bad rows; export round-trips and is defused', async () => {
    await Member.create({ email: 'exists@csv.test', status: 'unsubscribed' })
    const text = [
      'Name,Email,Subscribed,Labels',
      '"Smith, Jo",jo@csv.test,yes,"a,b"',
      'Exists,exists@csv.test,yes,',
      'Bad,not-an-email,yes,',
      '=HYPERLINK("http://x"),formula@csv.test,no,'
    ].join('\r\n')

    const res = response()
    await MemberAdminController.import(admin({ body: { csv: text } }), res)
    assert.strictEqual(res.body.imported, 2)
    assert.strictEqual(res.body.existing, 1)
    assert.strictEqual(res.body.invalid, 1)
    assert.strictEqual((await Member.findByEmail('exists@csv.test')).status, 'unsubscribed', 'never re-subscribed by an import')
    assert.strictEqual((await Member.findByEmail('jo@csv.test')).name, 'Smith, Jo')
    assert.strictEqual((await Member.findByEmail('formula@csv.test')).status, 'unsubscribed')

    const noHeader = response()
    await MemberAdminController.import(admin({ body: { csv: 'jo@csv.test\n' } }), noHeader)
    assert.strictEqual(noHeader.status, 422)

    const out = response()
    await MemberAdminController.export(admin(), out)
    assert.match(out.headers['content-type'], /^text\/csv/)
    assert.strictEqual(out.headers['cache-control'], 'no-store')
    assert.match(out.text, /^email,name,subscribed/)
    assert.match(out.text, /"Smith, Jo"/)
    assert.match(out.text, /'=HYPERLINK/, 'a formula is exported as text')
  })

  test('is behind user.manage, after auth', () => {
    const routes = read(`${FEATURE}/routes.ts`)
    assert.match(routes, /const manage = \[auth, requireCapability\('user\.manage'\)\]/)
    for (const path of ["'/api/members'", "'/api/members/export'", "'/api/members/import'", "'/api/members/:id'", "'/api/newsletters'"]) {
      assert.match(routes, new RegExp(`${path.replace(/[/:]/g, m => '\\' + m)}, \\.\\.\\.manage`), `${path} is managed`)
    }
  })
})

describe('the csv helper', () => {
  test('parses quotes, commas and line breaks inside fields', () => {
    assert.deepStrictEqual(csv.parseCsv('﻿a,b\n"x, y","he said ""hi"""\n"multi\nline",z\n\n'), [
      ['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', 'z']
    ])
  })

  test('quotes and defuses on the way out', () => {
    assert.strictEqual(csv.csvField('plain'), 'plain')
    assert.strictEqual(csv.csvField('a,b'), '"a,b"')
    assert.strictEqual(csv.csvField('=1+1'), "'=1+1")
    assert.strictEqual(csv.csvField('@SUM(A1)'), "'@SUM(A1)")
    assert.strictEqual(csv.csvField(null), '')
  })
})

describe('settings', () => {
  test('the members and newsletter keys are allowlisted and validated', () => {
    const ok = siteSettings.validateSettings({
      members_signup: 'invite',
      members_signin_url: 'https://front.example/verify',
      newsletter_sender_name: 'The Letter',
      newsletter_reply_to: 'editor@example.test',
      newsletter_footer: 'Thanks for reading.'
    })
    assert.ok('values' in ok)
    assert.strictEqual(ok.values.members_signup.group, 'members')

    const bad = siteSettings.validateSettings({
      members_signup: 'everyone',
      members_signin_url: 'javascript:alert(1)',
      newsletter_reply_to: 'not an address'
    })
    assert.ok('errors' in bad)
    assert.deepStrictEqual(Object.keys(bad.errors).sort(), ['members_signin_url', 'members_signup', 'newsletter_reply_to'])
  })
})

describe('the newsletter provider seam', () => {
  test('a listener that declines leaves the send to the built-in queue', async () => {
    const declines = (value) => value
    hooks.on('newsletter.delivering', declines, { name: 'test:declines' })
    try {
      const postId = await addPost(ids.editor, { title: 'Declined by provider', send_newsletter: 1 })
      const send = await newsletter.queueNewsletterFor(postId)
      assert.strictEqual(send.status, 'sending')
      assert.ok(Number(send.total_count) > 0, 'queued for the members')
    } finally {
      hooks.off('newsletter.delivering', 'test:declines')
    }
  })

  test('a listener that throws holds the send: nothing queued, nothing mailed', async () => {
    hooks.on('newsletter.delivering', () => { throw new Error('provider down') }, { name: 'test:throws' })
    const quiet = console.error
    console.error = () => {}
    try {
      const before = outbox.length
      const postId = await addPost(ids.editor, { title: 'Provider down', send_newsletter: 1 })
      const send = await newsletter.queueNewsletterFor(postId)
      assert.strictEqual(send.status, 'handoff_failed')
      assert.match(send.handoff_error, /provider down/)
      await newsletter.processNewsletterQueue(100)
      assert.strictEqual(Number((await db.get('SELECT COUNT(*) AS n FROM newsletter_queue WHERE send_id = ?', [send.id])).n), 0)
      assert.strictEqual(outbox.filter((m) => m.subject === 'Provider down').length, 0)
      assert.strictEqual(outbox.length >= before, true)
    } finally {
      console.error = quiet
      hooks.off('newsletter.delivering', 'test:throws')
    }
  })

  test('a listener that takes it gets the newsletter without the site\'s unsubscribe link', async () => {
    let seen
    hooks.on('newsletter.delivering', (value) => { seen = value; return { ...value, handledBy: 'test', externalId: 'x1' } }, { name: 'test:takes' })
    try {
      const postId = await addPost(ids.editor, { title: 'Taken by provider', send_newsletter: 1 })
      const send = await newsletter.queueNewsletterFor(postId)
      assert.strictEqual(send.status, 'handed_off')
      assert.strictEqual(send.provider, 'test')
      assert.strictEqual(send.external_id, 'x1')
      assert.strictEqual(seen.message.to, undefined)
      assert.doesNotMatch(String(seen.message.html), /members\/unsubscribe/)
      assert.strictEqual(seen.message.headers['List-Unsubscribe'], undefined)
    } finally {
      hooks.off('newsletter.delivering', 'test:takes')
    }
  })

  test('member changes are announced, with who made them', async () => {
    const heard = []
    for (const hook of ['member.created', 'member.updated', 'member.deleted']) {
      hooks.on(hook, (payload) => { heard.push([hook, payload.origin ?? null, payload.member?.email]) }, { name: `test:${hook}` })
    }
    try {
      const member = await Member.create({ email: 'announced@example.test', source: 'admin' })
      await Member.update(member.id, { name: 'Same' }, { origin: 'member' })
      await Member.update(member.id, { name: 'Same' }, { origin: 'member' })
      await Member.delete(member.id)
      assert.deepStrictEqual(heard, [
        ['member.created', null, 'announced@example.test'],
        ['member.updated', 'member', 'announced@example.test'],
        ['member.deleted', null, 'announced@example.test']
      ], 'an update that changes nothing is not announced')
    } finally {
      for (const hook of ['member.created', 'member.updated', 'member.deleted']) hooks.off(hook, `test:${hook}`)
    }
  })
})
