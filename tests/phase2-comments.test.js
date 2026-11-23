/**
 * Comments, phase 2: threads, a spam folder, the checks that fill it, and
 * the mail around moderation.
 *
 * The spam checks are pure functions and are exercised directly. The rest —
 * which routes need which capability, what the public list may carry, that a
 * mail can never fail a comment — is held in place by reading the source, as
 * the other suites here do. The behaviour itself was verified against a
 * running server on SQLite.
 */

import { test, describe, before } from 'node:test'
import assert from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

let guard

before(async () => {
  // A fixed key, so the module does not warn about generating one.
  process.env.APP_KEY ||= 'test-key-0123456789abcdef0123456789abcdef'
  guard = await import('../src/helpers/comment-guard.ts')
})

describe('the form token', () => {
  test('a token used after the minimum time is fine', () => {
    const now = Date.now()
    const token = guard.issueFormToken(7, now)
    assert.strictEqual(guard.checkFormToken(token, 7, now + guard.MIN_SUBMIT_MS + 1), 'ok')
  })

  test('a submission back within the minimum time is a bot', () => {
    const now = Date.now()
    const token = guard.issueFormToken(7, now)
    assert.strictEqual(guard.checkFormToken(token, 7, now + 500), 'too_fast')
  })

  test('an old token is only an old tab', () => {
    const now = Date.now()
    const token = guard.issueFormToken(7, now)
    assert.strictEqual(guard.checkFormToken(token, 7, now + guard.FORM_TOKEN_TTL_MS + 1), 'expired')
  })

  test('no token is its own answer, for forms that predate it', () => {
    assert.strictEqual(guard.checkFormToken(undefined, 7), 'missing')
    assert.strictEqual(guard.checkFormToken('', 7), 'missing')
  })

  test('a forged, tampered or cross-post token is invalid', () => {
    const now = Date.now()
    const token = guard.issueFormToken(7, now)
    assert.strictEqual(guard.checkFormToken('a.b.c', 7, now + 5000), 'invalid')
    assert.strictEqual(guard.checkFormToken(token.slice(0, -2) + 'xx', 7, now + 5000), 'invalid')
    assert.strictEqual(guard.checkFormToken(token, 8, now + 5000), 'invalid')
    assert.strictEqual(guard.checkFormToken({ token }, 7, now + 5000), 'invalid')
  })

  test('is not signed with APP_KEY itself, which signs sessions', () => {
    const source = read('src/helpers/comment-guard.ts')
    assert.match(source, /createHmac\('sha256', appKey\(/)
    assert.doesNotMatch(source, /signJwt\([^)]*process\.env\.APP_KEY/)
  })
})

describe('the unsubscribe token', () => {
  test('round-trips a comment id', () => {
    assert.strictEqual(guard.readUnsubscribeToken(guard.issueUnsubscribeToken(42)), 42)
  })

  test('rejects junk', () => {
    assert.strictEqual(guard.readUnsubscribeToken('nope'), null)
    assert.strictEqual(guard.readUnsubscribeToken(undefined), null)
  })

  test('a form token is not an unsubscribe token, or the reverse', () => {
    assert.strictEqual(guard.readUnsubscribeToken(guard.issueFormToken(42)), null)
    assert.strictEqual(guard.checkFormToken(guard.issueUnsubscribeToken(42), 42, Date.now() + 5000), 'invalid')
  })
})

describe('the blocklist', () => {
  const list = () => guard.parseBlocklist([
    '# a note',
    'Cheap Pills',
    'spammer@example.com',
    '@spam.example',
    '203.0.113.7',
    '198.51.100.0/24',
    '2001:db8:1:2::99',
    '10.0.0.0/99',
    ''
  ].join('\n'))

  const check = (submission) => guard.matchBlocklist(list(), { content: 'hello', ...submission })

  test('words match anywhere, ignoring case', () => {
    assert.strictEqual(check({ content: 'buy CHEAP pills today' }), 'blocklist: word')
    assert.strictEqual(check({ name: 'Cheap Pills Inc' }), 'blocklist: word')
    assert.strictEqual(check({ content: 'a fine comment' }), null)
  })

  test('addresses and whole domains', () => {
    assert.strictEqual(check({ email: 'Spammer@Example.com' }), 'blocklist: email')
    assert.strictEqual(check({ email: 'anyone@spam.example' }), 'blocklist: email domain')
    assert.strictEqual(check({ email: 'anyone@notspam.example' }), null)
  })

  test('IPv4 addresses and ranges', () => {
    assert.strictEqual(check({ ip: '203.0.113.7' }), 'blocklist: address')
    assert.strictEqual(check({ ip: '198.51.100.200' }), 'blocklist: address')
    assert.strictEqual(check({ ip: '198.51.101.1' }), null)
  })

  test('IPv6 is matched by the /64 the rate limiter reports', () => {
    assert.strictEqual(check({ ip: '2001:db8:1:2::/64' }), 'blocklist: address')
    assert.strictEqual(check({ ip: '2001:db8:1:3::/64' }), null)
  })

  test('a malformed range is skipped, not thrown', () => {
    assert.doesNotThrow(() => list())
    assert.strictEqual(check({ ip: '10.1.2.3' }), null)
  })

  test('an empty setting blocks nothing', () => {
    assert.strictEqual(guard.matchBlocklist(guard.parseBlocklist(null), { content: 'x', ip: '1.2.3.4' }), null)
  })

  test('the controller checks the address the rate limiter uses', () => {
    assert.match(read('src/middleware/rate-limits.ts'), /export const clientIp = \(req: Request\): string => clientAddress\(req, trustProxy\)/)
    assert.match(read('src/controllers/CommentController.ts'), /const ip = clientIp\(req\)/)
  })
})

describe('assess', () => {
  const base = () => ({
    submission: { content: 'A perfectly normal comment', email: 'a@b.example', ip: '192.0.2.1' },
    honeypot: '',
    formToken: guard.issueFormToken(1, Date.now() - 10_000),
    postId: 1,
    blocklist: guard.parseBlocklist(''),
    maxLinks: 2,
    trusted: false
  })

  test('a clean submission passes', () => {
    assert.deepStrictEqual(guard.assess(base()), { status: null, reason: null })
  })

  test('a filled honeypot is spam', () => {
    assert.strictEqual(guard.assess({ ...base(), honeypot: 'http://spam.example' }).status, 'spam')
  })

  test('too many links is held, not spam', () => {
    const verdict = guard.assess({ ...base(), submission: { content: 'http://a.example http://b.example www.c.example' } })
    assert.deepStrictEqual(verdict, { status: 'pending', reason: 'links: 3' })
  })

  test('the blocklist outranks the link count', () => {
    const verdict = guard.assess({
      ...base(),
      blocklist: guard.parseBlocklist('casino'),
      submission: { content: 'casino http://a http://b http://c' }
    })
    assert.strictEqual(verdict.status, 'spam')
  })

  test('a missing token holds the comment for a person', () => {
    assert.deepStrictEqual(guard.assess({ ...base(), formToken: undefined }), { status: 'pending', reason: 'form token: missing' })
  })

  test('a signed-in commenter skips the bot checks, not the blocklist', () => {
    assert.strictEqual(guard.assess({ ...base(), trusted: true, honeypot: 'x', formToken: undefined }).status, null)
    assert.strictEqual(guard.assess({ ...base(), trusted: true, blocklist: guard.parseBlocklist('normal') }).status, 'spam')
  })

  test('links are counted by scheme and www., not by dots', () => {
    assert.strictEqual(guard.countLinks('e.g. this. and that.'), 0)
    assert.strictEqual(guard.countLinks('see https://x.example and www.y.example'), 2)
  })
})

describe('the migration', () => {
  const migration = read('db/migrations/030_add_comment_status_and_notifications.js')

  test('adds a status and backfills it from the old flag', () => {
    assert.match(migration, /ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'/)
    assert.match(migration, /UPDATE comments SET status = 'approved' WHERE approved = 1/)
  })

  test('stores the opt-in, defaulting to no mail', () => {
    assert.match(migration, /ADD COLUMN notify_replies INTEGER NOT NULL DEFAULT 0/)
  })

  test('can be rolled back', () => {
    assert.match(migration, /export const down/)
    assert.match(migration, /DROP COLUMN status/)
  })
})

describe('threads', () => {
  const controller = read('src/controllers/CommentController.ts')

  test('a reply answers an approved comment on the same post', () => {
    assert.match(controller, /Number\(parent\.post_id\) !== postId \|\| parent\.status !== 'approved'/)
  })

  test('replies cannot nest past the limit', () => {
    assert.match(controller, /\(await Comment\.depthOf\(parent\)\) >= MAX_DEPTH/)
    assert.ok(guard.MAX_DEPTH >= 3 && guard.MAX_DEPTH <= 5)
  })

  test('the public list is the approved tree, with no address or IP', () => {
    const model = read('src/models/Comment.ts')
    const fn = model.slice(model.indexOf('async findPublicByPostId'), model.indexOf('async findPending'))
    assert.match(fn, /c\.status = 'approved'/)
    assert.doesNotMatch(fn, /c\.\*/)
    assert.doesNotMatch(fn, /email|author_ip/)
    assert.match(fn, /buildCommentTree/)
  })

  test("the commenter's own response carries no address either", () => {
    const fn = controller.slice(controller.indexOf('function submitted'), controller.indexOf('function idsFrom'))
    assert.doesNotMatch(fn, /email|author_ip|\.\.\.comment/)
    // Spam is reported as pending, so a bot cannot tell which check caught it.
    assert.match(fn, /comment\.status === 'approved' \? 'approved' : 'pending'/)
  })

  test('the public post page renders the thread', () => {
    assert.match(read('src/client/pages/FeedPost.tsx'), /<CommentThread postId=\{post\.id\} \/>/)
  })
})

describe('routes', () => {
  const routes = read('src/routes/api/comments.ts')

  test('posting keeps its rate limit and optional auth', () => {
    assert.match(routes, /commentLimit, optionalAuth, CommentController\.store/)
  })

  test('every moderation route needs comment.moderate', () => {
    for (const handler of ['index', 'pending', 'settings', 'bulk', 'empty', 'show', 'update', 'approve', 'setStatus', 'destroy']) {
      assert.match(routes, new RegExp(`auth, requireCapability\\('comment\\.moderate'\\), CommentController\\.${handler}\\)`), handler)
    }
  })

  test('changing the spam settings needs settings.manage', () => {
    assert.match(routes, /router\.put\('\/api\/comments\/settings', auth, requireCapability\('settings\.manage'\), CommentController\.updateSettings\)/)
  })

  test('static paths come before :id, which would swallow them', () => {
    const id = routes.indexOf("'/api/comments/:id'")
    for (const path of ['/api/comments/unsubscribe', '/api/comments/settings', '/api/comments/bulk', '/api/comments/empty']) {
      assert.ok(routes.indexOf(`'${path}'`) < id, path)
    }
  })

  test('unsubscribing needs the signed link, not a session', () => {
    assert.match(routes, /router\.get\('\/api\/comments\/unsubscribe', unsubscribeLimit, CommentController\.unsubscribePage\)/)
    assert.match(routes, /router\.post\('\/api\/comments\/unsubscribe', unsubscribeLimit, CommentController\.unsubscribe\)/)
  })

  test('the comment limit has a bucket of its own', () => {
    const limits = read('src/middleware/rate-limits.ts')
    const block = limits.slice(limits.indexOf('export const commentLimit'), limits.indexOf('export const unsubscribeLimit'))
    assert.match(block, /key: addressIn\('comment'\)/)
  })
})

describe('mail', () => {
  const controller = read('src/controllers/CommentController.ts')
  const mail = read('src/helpers/comment-mail.ts')

  test('is never awaited by the request', () => {
    assert.match(controller, /inBackground\('moderation notice', \(\) => notifyAwaitingModeration\(comment, post\)\)/)
    assert.match(controller, /inBackground\('reply notification', \(\) => notifyParentOfReply\(Number\(comment\.id\)\)\)/)
    assert.doesNotMatch(controller, /await notify(AwaitingModeration|ParentOfReply)/)
  })

  test('a failure is logged, never thrown', () => {
    assert.match(mail, /\.catch\(err => console\.error\(`\[comments\] \$\{label\} failed:`/)
  })

  test('replies are mailed only to those who opted in, once', () => {
    assert.match(mail, /if \(!parent \|\| !Number\(parent\.notify_replies\)\) return/)
    assert.match(mail, /if \(!\(await Comment\.claimReplyNotification\(Number\(reply\.id\)\)\)\) return/)
  })

  test('reply mail carries a signed one-click unsubscribe', () => {
    assert.match(mail, /issueUnsubscribeToken\(Number\(parent\.id\)\)/)
    assert.match(mail, /'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'/)
  })

  test('the unsubscribe page does not act on GET', () => {
    const fn = controller.slice(controller.indexOf('async unsubscribePage'), controller.indexOf('async unsubscribe('))
    assert.doesNotMatch(fn, /Comment\.unsubscribe/)
    assert.match(fn, /<form method="post"/)
  })

  test('the templates exist in both parts', () => {
    for (const name of ['comment-moderation', 'comment-reply']) {
      assert.ok(existsSync(join(ROOT, `mail/${name}.txt`)), `${name}.txt`)
      assert.ok(existsSync(join(ROOT, `mail/${name}.html`)), `${name}.html`)
    }
    assert.match(read('mail/comment-reply.txt'), /\{\{unsubscribeUrl\}\}/)
    assert.match(read('mail/comment-reply.html'), /\{\{unsubscribeUrl\}\}/)
  })
})

describe('the public form', () => {
  const thread = read('src/client/components/CommentThread.tsx')

  test('sends the token and the honeypot the server named', () => {
    assert.match(thread, /form_token: form\.token/)
    assert.match(thread, /\[form\.honeypot\]: trap/)
  })

  test('keeps the honeypot away from people', () => {
    assert.match(thread, /aria-hidden="true"/)
    assert.match(thread, /tabIndex=\{-1\}/)
  })

  test('asks before sending reply mail', () => {
    assert.match(thread, /notify_replies: notify/)
    assert.match(thread, /useState\(false\)/)
  })
})
