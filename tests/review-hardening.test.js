/**
 * The fixes from the November 2026 review, held in place.
 *
 * Each of these was a real hole: any signed-in account could publish, webhook
 * receivers held the key that mints admin sessions, the public comment list
 * handed out email addresses, the password change could never succeed, and a
 * session could not be ended. The behaviour was verified against a running
 * server; these keep the code that produces it from quietly going away.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

describe('publishing is a capability', () => {
  const routes = read('src/routes/api/posts.ts')
  const controller = read('src/controllers/PostController.ts')

  test('creating a post needs post.create, not just a session', () => {
    assert.match(routes, /router\.post\('\/api\/posts', (auth|contentWrite), requireCapability\('post\.create'\)/)
  })

  test('going live needs post.publish, checked again after the filter', () => {
    assert.match(controller, /finalStatus === 'published' && !wasPublished && !can\(req\.user, 'post\.publish'\)/)
    assert.match(controller, /if \(draft\?\.published && !can\(req\.user, 'post\.publish'\)\)/)
  })

  test('a published post cannot be edited without post.publish', () => {
    assert.match(controller, /if \(post\.published && !can\(req\.user, 'post\.publish'\)\)/)
  })

  test('ownership goes through can(), so the role still counts', () => {
    assert.match(controller, /return can\(req\.user, 'post\.edit', post\)/)
    assert.match(controller, /can\(req\.user, 'post\.delete', post\)/)
  })
})

describe('secrets stay apart', () => {
  test('webhooks are signed with WEBHOOK_SECRET, never APP_KEY', () => {
    const hooks = read('src/hooks.ts')
    assert.match(hooks, /process\.env\.WEBHOOK_SECRET/)
    assert.doesNotMatch(hooks, /secret: process\.env\.APP_KEY/)
  })
})

describe('comments', () => {
  const controller = read('src/controllers/CommentController.ts')
  const model = read('src/models/Comment.ts')

  test('the whole thread is for moderators only', () => {
    assert.match(controller, /req\.query\.all === 'true' && can\(req\.user, 'comment\.moderate'\)/)
  })

  test('the public list names its columns and carries no address', () => {
    const fn = model.slice(model.indexOf('async findPublicByPostId'), model.indexOf('async findPending'))
    assert.doesNotMatch(fn, /c\.\*/)
    assert.doesNotMatch(fn, /email/)
  })

  test('only a published post takes comments, and replies stay on their post', () => {
    assert.match(controller, /if \(!\(await Post\.findPublishedById\(postId\)\)\)/)
    assert.match(controller, /Number\(parent\.post_id\) !== postId/)
  })

  test('posting is rate limited and sees the signed-in user', () => {
    assert.match(read('src/routes/api/comments.ts'), /commentLimit, optionalAuth, CommentController\.store/)
  })
})

describe('sessions', () => {
  const middleware = read('src/middleware/auth.ts')

  test('every request checks the account, not just the signature', () => {
    assert.match(middleware, /SELECT role, email_verified, token_version, disabled_at FROM users WHERE id = \?/)
    assert.match(middleware, /account\.disabled_at \|\| Number\(account\.token_version \?\? 0\) !== tokenVersion/)
  })

  test('signing out and changing a password end the other sessions', () => {
    assert.match(read('src/controllers/AuthController.ts'), /await revokeSessions\(req\.userId!\)/)
    assert.match(read('src/controllers/ProfileController.ts'), /await revokeSessions\(req\.userId!\)/)
  })

  test('the password change uses the scrypt hash registration writes', () => {
    const profile = read('src/controllers/ProfileController.ts')
    assert.doesNotMatch(profile, /createHash\('sha256'\)/)
    assert.match(profile, /verifyPassword\(currentPassword, user\.password\)/)
  })

  test('changing the address needs the password and clears verification', () => {
    const profile = read('src/controllers/ProfileController.ts')
    assert.match(profile, /Enter your current password to change your email address/)
    assert.match(profile, /await resetVerification\(req\.userId!\)/)
  })

  test('an unknown address costs the same as a wrong password', () => {
    assert.match(read('src/controllers/AuthController.ts'), /await verifyPassword\(password, await decoyHash\(\)\)/)
  })
})

describe('feeds', () => {
  const feeds = read('src/controllers/FeedController.ts')

  test('links come from configuration, never the Host header', () => {
    assert.doesNotMatch(feeds, /req\.headers\.host/)
  })

  test('the JSON feed serves the sanitized render, not the Markdown source', () => {
    assert.match(feeds, /const html = post\.content_html \?\? ''/)
    assert.doesNotMatch(feeds, /content_html: post\.content\b/)
  })

  test('no CDATA section can be closed by its content', () => {
    assert.match(feeds, /replace\(\/\]\]>\/g, '\]\]\]\]><!\[CDATA\[>'\)/)
  })
})

describe('media', () => {
  test('browsing the library needs media.upload', () => {
    assert.match(read('src/routes/api/media.ts'), /router\.get\('\/api\/media', (auth|mediaWrite), requireCapability\('media\.upload'\)/)
  })

  test('editing and deleting check ownership against the row', () => {
    const controller = read('src/controllers/MediaController.ts')
    assert.strictEqual(controller.match(/can\(req\.user, 'media\.delete', media\)/g)?.length, 2)
  })

  test('an image is checked to be the image it claims to be', () => {
    assert.match(read('src/controllers/MediaController.ts'), /if \(!info \|\| info\.type !== result\.contentType\)/)
  })
})
