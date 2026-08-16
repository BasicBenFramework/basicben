/**
 * Presigned upload tests.
 *
 * Two properties carry the weight here, and both exist because a presigned URL
 * is weaker than it looks: it does not cap the upload size, and the key it was
 * issued for travels through the browser and comes back attacker-controlled.
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalAdapter } from './adapters/local.js'
import { signUpload, confirmUpload, deleteUpload, validateUpload, verifyTicket, DEFAULT_ALLOWED_TYPES } from './uploads.js'
import { hooks, HOOKS } from '../hooks/index.js'

const SECRET = 'upload-test-secret'

let dir
let storage

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bb-uploads-'))
  storage = createLocalAdapter({ dir, secret: SECRET })
})

const options = () => ({ storage, secret: SECRET })

const validFile = { filename: 'photo.png', contentType: 'image/png', size: 1024, userId: 7 }

describe('validateUpload', () => {
  test('accepts an ordinary image', () => {
    assert.equal(validateUpload(validFile).valid, true)
  })

  test('ignores content-type parameters', () => {
    assert.equal(validateUpload({ ...validFile, contentType: 'image/png; charset=utf-8' }).valid, true)
  })

  test('refuses types that execute in a browser', () => {
    // A bucket served from a domain hands these back with the type they were
    // stored under, which is same-origin script execution.
    for (const contentType of [
      'text/html', 'image/svg+xml', 'application/javascript',
      'text/javascript', 'application/xhtml+xml', 'application/x-httpd-php'
    ]) {
      const result = validateUpload({ ...validFile, contentType })
      assert.equal(result.valid, false, `${contentType} was allowed`)
    }
  })

  test('SVG stays refused even if an allowlist names it', () => {
    // An SVG is a document that can carry script. It is an image in name only.
    const result = validateUpload(
      { ...validFile, contentType: 'image/svg+xml' },
      { allowedTypes: ['image/svg+xml'] }
    )

    assert.equal(result.valid, false)
  })

  test('refuses a type outside the allowlist', () => {
    assert.equal(validateUpload({ ...validFile, contentType: 'application/zip' }).valid, false)
  })

  test('honours a custom allowlist', () => {
    const result = validateUpload({ ...validFile, contentType: 'application/zip' }, { allowedTypes: ['application/zip'] })
    assert.equal(result.valid, true)
  })

  test('refuses an oversized file', () => {
    assert.equal(validateUpload({ ...validFile, size: 20 * 1024 * 1024 }).valid, false)
  })

  test('refuses a missing or nonsensical size', () => {
    for (const size of [0, -1, undefined, null, 'big', NaN]) {
      assert.equal(validateUpload({ ...validFile, size }).valid, false, String(size))
    }
  })

  test('requires a filename and content type', () => {
    assert.equal(validateUpload({ ...validFile, filename: '' }).valid, false)
    assert.equal(validateUpload({ ...validFile, contentType: '' }).valid, false)
  })

  test('the default allowlist contains nothing executable', () => {
    for (const type of DEFAULT_ALLOWED_TYPES) {
      assert.ok(!/html|svg|javascript|xml|php/i.test(type), `${type} is in the default allowlist`)
    }
  })
})

describe('signUpload', () => {
  test('returns a URL, key and ticket', async () => {
    const result = await signUpload(validFile, options())

    assert.equal(result.ok, true)
    assert.ok(result.uploadUrl)
    assert.match(result.key, /^media\/\d{4}\/\d{2}\/[a-z0-9]+-photo\.png$/)
    assert.ok(result.ticket)
    assert.ok(result.expiresAt)
  })

  test('refuses before signing anything', async () => {
    const result = await signUpload({ ...validFile, contentType: 'text/html' }, options())

    assert.equal(result.ok, false)
    assert.equal(result.uploadUrl, undefined)
  })

  test('a traversing filename cannot choose where the object lands', async () => {
    const result = await signUpload({ ...validFile, filename: '../../etc/passwd.png' }, options())

    assert.equal(result.ok, true)
    assert.ok(!result.key.includes('..'), result.key)
    assert.ok(result.key.startsWith('media/'), result.key)
  })

  test('two uploads of the same name get different keys', async () => {
    const a = await signUpload(validFile, options())
    const b = await signUpload(validFile, options())

    assert.notEqual(a.key, b.key)
  })

  test('honours a prefix', async () => {
    const result = await signUpload(validFile, { ...options(), prefix: 'avatars' })
    assert.ok(result.key.startsWith('avatars/'))
  })
})

describe('confirmUpload', () => {
  test('records an upload that actually happened', async () => {
    const signed = await signUpload(validFile, options())
    await storage.put(signed.key, 'x'.repeat(1024), { contentType: 'image/png' })

    const result = await confirmUpload({ key: signed.key, ticket: signed.ticket, userId: 7 }, options())

    assert.equal(result.ok, true)
    assert.equal(result.size, 1024)
    assert.ok(result.url)
  })

  test('refuses when nothing was uploaded', async () => {
    // Confirming anyway creates a row pointing at nothing, which the media
    // library then renders as a broken image.
    const signed = await signUpload(validFile, options())

    const result = await confirmUpload({ key: signed.key, ticket: signed.ticket, userId: 7 }, options())

    assert.equal(result.ok, false)
    assert.match(result.error, /No file/)
  })

  test('refuses an empty file', async () => {
    const signed = await signUpload(validFile, options())
    await storage.put(signed.key, '')

    const result = await confirmUpload({ key: signed.key, ticket: signed.ticket, userId: 7 }, options())
    assert.equal(result.ok, false)
  })

  test('a key the ticket was not issued for is refused', async () => {
    // The whole reason the ticket exists: without it a caller could confirm
    // someone else's object as its own media row.
    const signed = await signUpload(validFile, options())
    await storage.put('media/2026/01/someone-elses.png', 'x'.repeat(100))

    const result = await confirmUpload(
      { key: 'media/2026/01/someone-elses.png', ticket: signed.ticket, userId: 7 },
      options()
    )

    assert.equal(result.ok, false)
    assert.match(result.error, /Invalid upload ticket/)
  })

  test('a ticket issued to another user is refused', async () => {
    const signed = await signUpload(validFile, options())
    await storage.put(signed.key, 'x'.repeat(100))

    const result = await confirmUpload({ key: signed.key, ticket: signed.ticket, userId: 99 }, options())

    assert.equal(result.ok, false)
  })

  test('a forged ticket is refused', async () => {
    const signed = await signUpload(validFile, options())
    await storage.put(signed.key, 'x'.repeat(100))

    for (const ticket of [
      'not-a-ticket',
      `${Math.floor(Date.now() / 1000) + 900}.${'a'.repeat(64)}`,
      `${Math.floor(Date.now() / 1000) + 900}.`,
      ''
    ]) {
      const result = await confirmUpload({ key: signed.key, ticket, userId: 7 }, options())
      assert.equal(result.ok, false, `accepted ${JSON.stringify(ticket)}`)
    }
  })

  test('an expired ticket is refused', async () => {
    const signed = await signUpload(validFile, options())
    await storage.put(signed.key, 'x'.repeat(100))

    // The expiry is stamped into the ticket, so an elapsed one is produced by
    // rewriting it rather than by sleeping — expiries are second-granular, and
    // waiting for one to pass is a race the test loses about half the time.
    const past = Math.floor(Date.now() / 1000) - 60
    const expired = `${past}.${signed.ticket.split('.')[1]}`

    const result = await confirmUpload({ key: signed.key, ticket: expired, userId: 7 }, options())

    assert.equal(result.ok, false)
    assert.match(result.error, /expired/)
  })

  test('expiry is checked before the signature', async () => {
    // Otherwise an attacker learns whether a forged signature was close by
    // whether the error says "expired" or "invalid".
    const past = Math.floor(Date.now() / 1000) - 60

    assert.equal(verifyTicket({ key: 'k', ticket: `${past}.${'a'.repeat(64)}` }).reason, 'expired')
  })

  test('an oversized upload is refused and removed', async () => {
    // The presigned URL cannot enforce a size limit, so this is the only place
    // it can be enforced — and the bytes must not be left in the bucket.
    const signed = await signUpload(validFile, options())
    await storage.put(signed.key, 'x'.repeat(2048))

    const result = await confirmUpload(
      { key: signed.key, ticket: signed.ticket, userId: 7 },
      { ...options(), maxSize: 1024 }
    )

    assert.equal(result.ok, false)
    assert.match(result.error, /or smaller/)
    assert.equal(await storage.exists(signed.key), false, 'the oversized object was left in place')
  })

  test('the real size is used, not the declared one', async () => {
    // A caller declaring 1 KB and uploading 5 KB must not get away with it.
    const signed = await signUpload({ ...validFile, size: 1024 }, options())
    await storage.put(signed.key, 'x'.repeat(5000))

    const result = await confirmUpload(
      { key: signed.key, ticket: signed.ticket, userId: 7 },
      { ...options(), maxSize: 2048 }
    )

    assert.equal(result.ok, false)
  })

  test('requires both a key and a ticket', async () => {
    assert.equal((await confirmUpload({}, options())).ok, false)
    assert.equal((await confirmUpload({ key: 'a' }, options())).ok, false)
    assert.equal((await confirmUpload({ ticket: 'a' }, options())).ok, false)
  })
})

describe('verifyTicket', () => {
  test('rejects malformed input without throwing', () => {
    for (const ticket of [null, undefined, 42, {}, '', 'no-dot', '.']) {
      assert.equal(verifyTicket({ key: 'k', ticket }).valid, false, String(ticket))
    }
  })
})

describe('hooks', () => {
  test('media.uploading can rewrite the key', async () => {
    const handler = (payload) => ({ ...payload, key: `rewritten/${payload.key}` })
    hooks.on(HOOKS.MEDIA_UPLOADING, handler)

    try {
      const result = await signUpload(validFile, options())
      assert.ok(result.key.startsWith('rewritten/'), result.key)
    } finally {
      hooks.off(HOOKS.MEDIA_UPLOADING, handler)
    }
  })

  test('media.uploading can refuse an upload', async () => {
    const handler = (payload) => ({ ...payload, cancel: true, reason: 'Quota exceeded.' })
    hooks.on(HOOKS.MEDIA_UPLOADING, handler)

    try {
      const result = await signUpload(validFile, options())
      assert.equal(result.ok, false)
      assert.equal(result.error, 'Quota exceeded.')
    } finally {
      hooks.off(HOOKS.MEDIA_UPLOADING, handler)
    }
  })

  test('media.uploaded fires on confirmation', async () => {
    const seen = []
    const handler = (payload) => { seen.push(payload) }
    hooks.on(HOOKS.MEDIA_UPLOADED, handler)

    try {
      const signed = await signUpload(validFile, options())
      await storage.put(signed.key, 'x'.repeat(100))
      await confirmUpload({ key: signed.key, ticket: signed.ticket, userId: 7 }, options())

      assert.equal(seen.length, 1)
      assert.equal(seen[0].key, signed.key)
    } finally {
      hooks.off(HOOKS.MEDIA_UPLOADED, handler)
    }
  })

  test('media.deleted fires on removal', async () => {
    const seen = []
    const handler = (payload) => { seen.push(payload) }
    hooks.on(HOOKS.MEDIA_DELETED, handler)

    try {
      await storage.put('media/gone.png', 'x')
      await deleteUpload('media/gone.png', options())

      assert.equal(seen.length, 1)
      assert.equal(seen[0].key, 'media/gone.png')
    } finally {
      hooks.off(HOOKS.MEDIA_DELETED, handler)
    }
  })
})
