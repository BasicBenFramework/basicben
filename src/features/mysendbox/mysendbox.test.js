/**
 * The mysendbox feature, against a fake MySendbox.
 *
 * Runs the real members feature and the real host on a scratch SQLite
 * database, with MySendbox's API replaced by an in-memory fake that answers
 * the way the real routes do (cf-email-service, workers/app/worker/routes):
 * 409 for re-adding someone who unsubscribed, a draft broadcast that needs
 * scheduling, and so on. What matters: members reach MySendbox with a
 * consent record or not at all, a post becomes exactly one broadcast however
 * the hand-off fails and retries, and MySendbox's unsubscribes come back.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHmac } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const FEATURE = 'src/features/mysendbox'
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')
const load = (path) => import(pathToFileURL(join(ROOT, path)).href)

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        try { return nextResolve(`${specifier}.ts`, context) } catch {}
        return nextResolve(`${specifier}/index.ts`, context)
      }
      throw err
    }
  }
})

const scratch = mkdtempSync(join(tmpdir(), 'basicben-mysendbox-'))
process.env.DATABASE_URL = join(scratch, 'test.sqlite')
process.env.APP_KEY = 'mysendbox-test-key-that-is-long-enough-to-sign'
process.env.APP_URL = 'https://cms.example.test'
process.env.SITE_URL = 'https://blog.example.test'
process.env.MYSENDBOX_API_KEY = 'msb_test_key'
process.env.MYSENDBOX_WEBHOOK_SECRET = 'whsec_test_secret'

/** An in-memory MySendbox. `calls` is every request, for asserting what was asked. */
function fakeMySendbox() {
  const state = { audiences: [], contacts: new Map(), broadcasts: new Map(), calls: [], failSchedule: 0, n: 0 }
  const id = (prefix) => `${prefix}_${++state.n}`
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

  async function fetch(url, init = {}) {
    const { pathname, searchParams } = new URL(url)
    const path = pathname.replace(/^\/v1/, '')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    state.calls.push({ method, path, body })
    assert.strictEqual(init.headers?.Authorization, 'Bearer msb_test_key')

    let m
    if (method === 'POST' && path === '/audiences') {
      const audience = { id: id('aud'), name: body.name }
      state.audiences.push(audience)
      return json(audience, 201)
    }
    if (method === 'GET' && path === '/audiences') return json({ audiences: state.audiences })

    if (method === 'POST' && path === '/contacts') {
      assert.ok(body.consent, 'consent is required')
      const existing = [...state.contacts.values()].find((c) => c.email === body.email)
      if (existing && ['unsubscribed', 'bounced', 'complained'].includes(existing.status)) {
        return json({ error: `this contact is ${existing.status}; only they can subscribe again, through a signup form` }, 409)
      }
      const contact = existing ?? { id: id('con'), email: body.email }
      Object.assign(contact, { name: body.name, attributes: body.attributes, audienceIds: body.audienceIds, status: body.confirmed ? 'subscribed' : 'pending', consent: body.consent })
      state.contacts.set(contact.id, contact)
      return json(contact, existing ? 200 : 201)
    }
    if (method === 'POST' && (m = /^\/contacts\/(con_\d+)\/unsubscribe$/.exec(path))) {
      const contact = state.contacts.get(m[1])
      if (!contact) return json({ error: 'not found' }, 404)
      contact.status = 'unsubscribed'
      return json(contact)
    }
    if (method === 'DELETE' && (m = /^\/contacts\/(con_\d+)$/.exec(path))) {
      state.contacts.delete(m[1])
      return json({ deleted: true })
    }
    if (method === 'GET' && path === '/contacts') {
      const status = searchParams.get('status')
      const contacts = [...state.contacts.values()].filter((c) => !status || c.status === status)
      return json({ contacts, next: null })
    }
    if (method === 'POST' && (m = /^\/forms\/(frm_\w+)\/subscribe$/.exec(path))) {
      const existing = [...state.contacts.values()].find((c) => c.email === body.email)
      const contact = existing ?? { id: id('con'), email: body.email }
      contact.status = 'pending'
      state.contacts.set(contact.id, contact)
      return json({ contact, confirmationSent: true }, 202)
    }

    if (method === 'POST' && path === '/broadcasts') {
      const broadcast = { id: id('cmp'), status: 'draft', ...body }
      state.broadcasts.set(broadcast.id, broadcast)
      return json(broadcast, 201)
    }
    if (method === 'POST' && (m = /^\/broadcasts\/(cmp_\d+)\/schedule$/.exec(path))) {
      if (state.failSchedule > 0) {
        state.failSchedule--
        return json({ error: 'temporarily unavailable' }, 503)
      }
      const broadcast = state.broadcasts.get(m[1])
      if (broadcast.status !== 'draft') return json({ error: 'campaign is not a draft' }, 409)
      broadcast.status = 'scheduled'
      return json(broadcast)
    }
    if (method === 'GET' && (m = /^\/broadcasts\/(cmp_\d+)$/.exec(path))) {
      const broadcast = state.broadcasts.get(m[1])
      return broadcast ? json({ ...broadcast, stats: { sent: 1, delivered: 2, opened: 1, clicked: 0, unsubscribed: 0 } }) : json({ error: 'not found' }, 404)
    }
    if (method === 'GET' && path === '/segments/count') return json({ total: 3, subscribed: 2, sendable: 2 })

    return json({ error: `fake has no ${method} ${path}` }, 404)
  }

  return { state, fetch }
}

const fake = fakeMySendbox()
let db, hooks, Member, newsletter, contacts, config, webhook, MemberAdminController, Settings

function response() {
  return {
    status: 200,
    headers: {},
    json(data, status = 200) { this.body = data; this.status = status },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value }
  }
}

async function addPost(title, { send_newsletter = 1, published = 1 } = {}) {
  const at = new Date(Date.now() - 1000).toISOString()
  const result = await db.run(
    `INSERT INTO posts (title, slug, content, content_html, excerpt, user_id, published, status, publish_at, visibility, send_newsletter, created_at, updated_at)
     VALUES (?, ?, 'Body', '<p>Body of the post.</p>', 'The teaser.', ?, ?, ?, ?, 'public', ?, ?, ?)`,
    [title, title.toLowerCase().replace(/\W+/g, '-'), ids.admin, published, published ? 'published' : 'draft', at, send_newsletter, at, at]
  )
  return Number(result.lastInsertRowid)
}

const callsTo = (method, pattern) => fake.state.calls.filter((c) => c.method === method && pattern.test(c.path))
const ids = {}

before(async () => {
  const { createMigrator } = await load('node_modules/@basicbenframework/core/src/db/migrator.js')
  await (await createMigrator()).migrate()
  db = await (await import('@basicbenframework/core/db')).getDb()
  ;({ hooks } = await import('@basicbenframework/core/hooks'))

  config = await load(`${FEATURE}/config.ts`)
  config.setClientOptions({ fetch: fake.fetch, baseUrl: 'https://api.mysendbox.test/v1' })
  contacts = await load(`${FEATURE}/contacts.ts`)
  contacts.setBackgroundSync(false)

  await (await load('src/host/index.ts')).registerFeatures([
    (await load('src/features/members/index.ts')).default,
    (await load(`${FEATURE}/index.ts`)).default
  ])

  ;({ Member } = await load('src/features/members/Member.ts'))
  ;({ MemberAdminController } = await load('src/features/members/MemberAdminController.ts'))
  ;({ Settings } = await load('src/models/Settings.ts'))
  newsletter = await load('src/features/members/newsletter.ts')
  webhook = await load(`${FEATURE}/webhook.ts`)

  const user = await db.run("INSERT INTO users (name, email, password, role, email_verified) VALUES ('Admin', 'admin@example.test', 'x', 'admin', 1)")
  ids.admin = Number(user.lastInsertRowid)
  await Settings.set('site_name', 'Example', 'general')
})

after(() => rmSync(scratch, { recursive: true, force: true }))

describe('the seam', () => {
  test('the hook names match the members feature', async () => {
    const events = await load('src/features/members/events.ts')
    const broadcasts = await load(`${FEATURE}/broadcasts.ts`)
    assert.deepStrictEqual(contacts.MEMBER_EVENTS, events.MEMBER_HOOKS)
    assert.strictEqual(contacts.SUBSCRIPTION_HOOK, events.NEWSLETTER_HOOKS.SUBSCRIPTION)
    assert.strictEqual(broadcasts.DELIVERING_HOOK, events.NEWSLETTER_HOOKS.DELIVERING)
    assert.strictEqual(broadcasts.STATUS_HOOK, events.NEWSLETTER_HOOKS.STATUS)
  })

  test('the feature imports nothing of the members feature', () => {
    for (const file of ['index.ts', 'contacts.ts', 'broadcasts.ts', 'webhook.ts', 'config.ts', 'controller.ts', 'routes.ts']) {
      assert.doesNotMatch(read(`${FEATURE}/${file}`), /from ['"]\.\.\/members/, file)
    }
  })
})

describe('members to contacts', () => {
  test('someone who signed up is copied as subscribed, with how they agreed', async () => {
    const member = await Member.create({ email: 'reader@example.test', name: 'Reader', source: 'signup', email_verified_at: new Date().toISOString() })
    ids.reader = member.id
    await contacts.syncDirty()

    const contact = [...fake.state.contacts.values()].find((c) => c.email === 'reader@example.test')
    assert.strictEqual(contact.status, 'subscribed')
    assert.match(contact.consent, /Signed up for Example/)
    assert.deepStrictEqual(contact.attributes, { cms_member_id: member.id })
    assert.strictEqual(fake.state.audiences.length, 1, 'the audience is made once')
    assert.deepStrictEqual(contact.audienceIds, [fake.state.audiences[0].id])
    assert.strictEqual(await config.setting('mysendbox_audience_id'), fake.state.audiences[0].id)

    // Syncing again asks nothing new.
    const before = fake.state.calls.length
    await contacts.syncDirty()
    assert.strictEqual(fake.state.calls.length, before)
  })

  test('someone an admin added waits for an attestation, then is copied with it', async () => {
    const res = response()
    await MemberAdminController.store({ body: { email: 'added@example.test', name: 'Added' }, params: {}, headers: {} }, res)
    assert.strictEqual(res.status, 201, JSON.stringify(res.body))
    ids.added = res.body.member.id

    await contacts.syncDirty()
    assert.ok(![...fake.state.contacts.values()].some((c) => c.email === 'added@example.test'), 'not copied without consent')
    assert.strictEqual((await db.get('SELECT state FROM mysendbox_contacts WHERE member_id = ?', [ids.added])).state, 'needs_consent')

    await Settings.set('mysendbox_consent_attestation', 'They asked at our event and signed the sheet.', 'mysendbox')
    const done = await contacts.backfill()
    assert.strictEqual(done.remaining, 0)
    const contact = [...fake.state.contacts.values()].find((c) => c.email === 'added@example.test')
    assert.strictEqual(contact.status, 'subscribed')
    assert.match(contact.consent, /signed the sheet/)
  })

  test('with a signup form and no attestation, an imported member gets the double opt-in', async () => {
    await Settings.set('mysendbox_consent_attestation', '', 'mysendbox')
    await Settings.set('mysendbox_form_id', 'frm_abc', 'mysendbox')
    const member = await Member.create({ email: 'imported@example.test', source: 'import' })
    await contacts.syncDirty()
    await contacts.syncDirty()
    assert.strictEqual(callsTo('POST', /^\/forms\/frm_abc\/subscribe$/).filter((c) => c.body.email === 'imported@example.test').length, 1, 'one confirmation mail, not one per sync')
    assert.strictEqual((await db.get('SELECT remote_status FROM mysendbox_contacts WHERE member_id = ?', [member.id])).remote_status, 'pending')
    await Settings.set('mysendbox_form_id', '', 'mysendbox')
  })

  test('an unsubscribe in the CMS reaches MySendbox, and is not echoed back', async () => {
    await Member.update(ids.reader, { status: 'unsubscribed' }, { origin: 'member' })
    await contacts.syncDirty()
    const contact = [...fake.state.contacts.values()].find((c) => c.email === 'reader@example.test')
    assert.strictEqual(contact.status, 'unsubscribed')
    assert.strictEqual(callsTo('POST', /\/unsubscribe$/).length, 1)
  })

  test('turning it back on in the CMS cannot override MySendbox: the member follows MySendbox', async () => {
    await Member.update(ids.reader, { status: 'active' }, { origin: 'member' })
    const state = await contacts.syncMember(ids.reader)
    assert.strictEqual(state, 'refused')
    assert.strictEqual((await Member.find(ids.reader)).status, 'unsubscribed', 'MySendbox decides')
  })

  test('a deleted member is erased in MySendbox', async () => {
    const member = await Member.create({ email: 'leaving@example.test', source: 'signup', email_verified_at: new Date().toISOString() })
    await contacts.syncDirty()
    const contact = [...fake.state.contacts.values()].find((c) => c.email === 'leaving@example.test')
    await Member.delete(member.id)
    await contacts.syncDirty()
    assert.ok(!fake.state.contacts.has(contact.id))
    assert.ok(!(await db.get('SELECT 1 FROM mysendbox_contacts WHERE member_id = ?', [member.id])))
  })

  test('a MySendbox outage is retried, not lost', async () => {
    const member = await Member.create({ email: 'later@example.test', source: 'signup', email_verified_at: new Date().toISOString() })
    config.setClientOptions({ fetch: async () => { throw new Error('connection refused') }, baseUrl: 'https://api.mysendbox.test/v1' })
    await contacts.syncDirty()
    const row = await db.get('SELECT state, attempts, last_error FROM mysendbox_contacts WHERE member_id = ?', [member.id])
    assert.strictEqual(row.state, 'dirty')
    assert.strictEqual(Number(row.attempts), 1)
    assert.match(row.last_error, /could not be reached/)

    config.setClientOptions({ fetch: fake.fetch, baseUrl: 'https://api.mysendbox.test/v1' })
    await contacts.syncDirty()
    assert.strictEqual((await db.get('SELECT state FROM mysendbox_contacts WHERE member_id = ?', [member.id])).state, 'synced')
  })
})

describe('posts to broadcasts', () => {
  test('a live post asking for a send becomes one scheduled broadcast, and nothing is queued', async () => {
    const postId = await addPost('Hello letter')
    const send = await newsletter.queueNewsletterFor(postId)
    assert.strictEqual(send.status, 'handed_off')
    assert.strictEqual(send.provider, 'mysendbox')
    assert.match(send.external_id, /^cmp_/)

    const broadcast = fake.state.broadcasts.get(send.external_id)
    assert.strictEqual(broadcast.status, 'scheduled')
    assert.strictEqual(broadcast.subject, 'Hello letter')
    assert.strictEqual(broadcast.audienceId, fake.state.audiences[0].id)
    assert.strictEqual(broadcast.preheader, 'The teaser.')
    assert.match(broadcast.html, /Body of the post/)
    assert.doesNotMatch(broadcast.html, /members\/unsubscribe/, "MySendbox adds its own unsubscribe; the CMS's would be the wrong list")
    assert.doesNotMatch(broadcast.text, /members\/unsubscribe/)

    assert.strictEqual(Number((await db.get('SELECT COUNT(*) AS n FROM newsletter_queue WHERE send_id = ?', [send.id])).n), 0)

    // Queued again, processed again: still one broadcast.
    await newsletter.queueNewsletterFor(postId)
    await newsletter.processNewsletterQueue()
    assert.strictEqual(callsTo('POST', /^\/broadcasts$/).filter((c) => c.body.subject === 'Hello letter').length, 1)
    ids.handedOff = postId
  })

  test('a failed hand-off is retried later, never sent by the built-in queue, and never makes a second broadcast', async () => {
    fake.state.failSchedule = 1
    const postId = await addPost('Retry letter')
    const quiet = console.error
    console.error = () => {}
    const failed = await newsletter.queueNewsletterFor(postId).finally(() => { console.error = quiet })
    assert.strictEqual(failed.status, 'handoff_failed')
    assert.match(failed.handoff_error, /would not start the broadcast/)
    assert.strictEqual(Number((await db.get('SELECT COUNT(*) AS n FROM newsletter_queue WHERE send_id = ?', [failed.id])).n), 0)

    // Too soon: not retried yet.
    await newsletter.processNewsletterQueue()
    assert.strictEqual((await newsletter.newsletterFor(postId)).status, 'handoff_failed')

    await db.run('UPDATE newsletter_sends SET started_at = ? WHERE id = ?', [new Date(Date.now() - newsletter.HANDOFF_RETRY_MS - 1000).toISOString(), failed.id])
    await newsletter.processNewsletterQueue()
    const sent = await newsletter.newsletterFor(postId)
    assert.strictEqual(sent.status, 'handed_off')
    assert.strictEqual(callsTo('POST', /^\/broadcasts$/).filter((c) => c.body.subject === 'Retry letter').length, 1, 'the recorded broadcast was reused')
    assert.strictEqual(fake.state.broadcasts.get(sent.external_id).status, 'scheduled')
  })

  test('the editor sees MySendbox\'s counts', async () => {
    const res = response()
    await MemberAdminController.status({ resource: { id: ids.handedOff, send_newsletter: 1 }, user: { id: ids.admin, role: 'admin' }, headers: {} }, res)
    assert.strictEqual(res.body.provider.name, 'MySendbox')
    assert.strictEqual(res.body.provider.status, 'scheduled')
    assert.strictEqual(res.body.provider.counts.delivered, 2)
    assert.strictEqual(res.body.provider.counts.recipients, 3)
  })
})

describe('MySendbox to the CMS', () => {
  const sign = (body, t = Math.floor(Date.now() / 1000)) =>
    `t=${t},v1=${createHmac('sha256', 'whsec_test_secret').update(`${t}.${body}`).digest('hex')}`

  async function deliver(event, { signature } = {}) {
    const raw = JSON.stringify(event)
    const res = response()
    await webhook.mysendboxWebhook({ headers: { 'mysendbox-signature': signature ?? sign(raw) }, rawBody: raw }, res)
    return res
  }

  test('an unsubscribe there unsubscribes the member here', async () => {
    const member = await Member.find(ids.added)
    assert.strictEqual(member.status, 'active')
    const contact = [...fake.state.contacts.values()].find((c) => c.email === 'added@example.test')

    const res = await deliver({ id: 'evt_1', type: 'contact.updated', data: {
      contactId: contact.id, email: contact.email, attributes: { cms_member_id: ids.added }, status: 'unsubscribed',
      previousStatus: 'subscribed', change: 'status', source: 'form', at: Date.now()
    } })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.result, 'applied')
    assert.strictEqual((await Member.find(ids.added)).status, 'unsubscribed')

    // The echo does not go back to MySendbox as a new unsubscribe.
    const before = callsTo('POST', /\/unsubscribe$/).length
    await contacts.syncDirty()
    assert.strictEqual(callsTo('POST', /\/unsubscribe$/).length, before)
  })

  test('an older event delivered late does not undo a newer one', async () => {
    const contact = [...fake.state.contacts.values()].find((c) => c.email === 'added@example.test')
    const res = await deliver({ id: 'evt_0', type: 'contact.updated', data: {
      contactId: contact.id, email: contact.email, status: 'subscribed', change: 'status', at: Date.now() - 60_000
    } })
    assert.strictEqual(res.body.result, 'stale')
    assert.strictEqual((await Member.find(ids.added)).status, 'unsubscribed')
  })

  test('a bad or old signature is refused, and other events are ignored', async () => {
    const event = { id: 'evt_2', type: 'contact.updated', data: { email: 'added@example.test', status: 'subscribed' } }
    assert.strictEqual((await deliver(event, { signature: 't=1,v1=' + '0'.repeat(64) })).status, 401)
    const old = Math.floor(Date.now() / 1000) - 3600
    assert.strictEqual((await deliver(event, { signature: sign(JSON.stringify(event), old) })).status, 401)
    const other = await deliver({ id: 'evt_3', type: 'email.delivered', data: {} })
    assert.strictEqual(other.status, 200)
    assert.strictEqual(other.body.ignored, 'email.delivered')
  })

  test('with no webhook secret the endpoint does not exist', async () => {
    const secret = process.env.MYSENDBOX_WEBHOOK_SECRET
    delete process.env.MYSENDBOX_WEBHOOK_SECRET
    try {
      const res = response()
      await webhook.mysendboxWebhook({ headers: {}, rawBody: '{}' }, res)
      assert.strictEqual(res.status, 404)
    } finally {
      process.env.MYSENDBOX_WEBHOOK_SECRET = secret
    }
  })

  test('the daily pull catches an unsubscribe a missed webhook did not bring', async () => {
    const member = await Member.create({ email: 'missed@example.test', source: 'signup', email_verified_at: new Date().toISOString() })
    await contacts.syncDirty()
    const contact = [...fake.state.contacts.values()].find((c) => c.email === 'missed@example.test')
    contact.status = 'complained'

    const pulled = await contacts.pullUnsubscribes()
    assert.ok(pulled.applied >= 1)
    assert.strictEqual((await Member.find(member.id)).status, 'unsubscribed')
  })
})
