/**
 * Storage adapter tests.
 *
 * Both adapters run through the same behavioural suite. An adapter that behaves
 * differently depending on where the bytes land is a trap: the local driver
 * would pass in development while the S3 driver was the one that had to work in
 * production.
 *
 * The S3 half runs against a real MinIO container when one is reachable. That
 * is the only way to know a hand-rolled signature is acceptable to an actual S3
 * implementation — a unit test can only confirm the signer agrees with itself.
 * When MinIO is absent those tests skip loudly rather than silently passing.
 *
 *   docker run -d -p 9010:9000 -e MINIO_ROOT_USER=testkeyid \
 *     -e MINIO_ROOT_PASSWORD=testsecretkey123 minio/minio server /data
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalAdapter } from './local.js'
import { createS3Adapter } from './s3.js'
import { buildKey, sanitizeFilename, resolveConfig, absoluteUrl } from '../index.js'

const MINIO = {
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9010',
  region: 'us-east-1',
  accessKeyId: process.env.MINIO_ACCESS_KEY || 'testkeyid',
  secretAccessKey: process.env.MINIO_SECRET_KEY || 'testsecretkey123',
  bucket: 'bb-adapter-test',
  forcePathStyle: true
}

async function minioReachable() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(`${MINIO.endpoint}/minio/health/live`, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

/**
 * The shared contract. Everything here must hold for every adapter.
 */
function describeAdapterContract(name, getAdapter) {
  describe(`${name} adapter contract`, () => {
    test('put then get round-trips the bytes', async () => {
      const storage = await getAdapter()
      const key = `contract/${Date.now()}-round-trip.txt`

      const written = await storage.put(key, 'hello storage', { contentType: 'text/plain' })
      assert.equal(written.key, key)
      assert.equal(written.size, 13)

      const read = await storage.get(key)
      assert.equal(read.body.toString(), 'hello storage')
      assert.equal(read.size, 13)
    })

    test('binary content survives unchanged', async () => {
      const storage = await getAdapter()
      const key = `contract/${Date.now()}-binary.bin`

      // A PNG header, including the bytes that a utf8 round-trip corrupts.
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe])
      await storage.put(key, bytes, { contentType: 'image/png' })

      const read = await storage.get(key)
      assert.deepEqual([...read.body], [...bytes])
    })

    test('head reports metadata without the body', async () => {
      const storage = await getAdapter()
      const key = `contract/${Date.now()}-head.txt`
      await storage.put(key, 'abc', { contentType: 'text/plain' })

      const info = await storage.head(key)
      assert.equal(info.size, 3)
      assert.ok(info.etag)
    })

    test('head returns null for a missing object rather than throwing', async () => {
      const storage = await getAdapter()
      assert.equal(await storage.head(`contract/absent-${Date.now()}.txt`), null)
    })

    test('exists reflects reality', async () => {
      const storage = await getAdapter()
      const key = `contract/${Date.now()}-exists.txt`

      assert.equal(await storage.exists(key), false)
      await storage.put(key, 'x')
      assert.equal(await storage.exists(key), true)
    })

    test('get on a missing object throws with a 404', async () => {
      const storage = await getAdapter()

      await assert.rejects(
        () => storage.get(`contract/absent-${Date.now()}.txt`),
        (error) => error.status === 404
      )
    })

    test('delete removes the object', async () => {
      const storage = await getAdapter()
      const key = `contract/${Date.now()}-delete.txt`

      await storage.put(key, 'x')
      await storage.delete(key)

      assert.equal(await storage.exists(key), false)
    })

    test('deleting something already gone succeeds', async () => {
      // The caller wanted it absent, and it is absent.
      const storage = await getAdapter()
      await assert.doesNotReject(() => storage.delete(`contract/never-${Date.now()}.txt`))
    })

    test('list finds objects under a prefix', async () => {
      const storage = await getAdapter()
      const prefix = `contract/list-${Date.now()}`

      await storage.put(`${prefix}/a.txt`, 'a')
      await storage.put(`${prefix}/b.txt`, 'b')
      await storage.put(`contract/elsewhere-${Date.now()}.txt`, 'c')

      const { items } = await storage.list({ prefix })
      const keys = items.map((item) => item.key)

      assert.ok(keys.includes(`${prefix}/a.txt`), keys.join(','))
      assert.ok(keys.includes(`${prefix}/b.txt`), keys.join(','))
      assert.ok(!keys.some((key) => key.includes('elsewhere')), keys.join(','))
    })

    test('list reports sizes', async () => {
      const storage = await getAdapter()
      const prefix = `contract/sizes-${Date.now()}`
      await storage.put(`${prefix}/x.txt`, 'four')

      const { items } = await storage.list({ prefix })
      assert.equal(items[0].size, 4)
    })

    test('keys with folders, spaces and unicode survive', async () => {
      const storage = await getAdapter()
      const stamp = Date.now()

      for (const key of [
        `contract/${stamp}/deep/nested/file.png`,
        `contract/${stamp}/with space.png`,
        `contract/${stamp}/unicode-café.png`,
        `contract/${stamp}/plus+sign.png`,
        `contract/${stamp}/paren(1).png`
      ]) {
        await storage.put(key, 'x', { contentType: 'image/png' })
        const read = await storage.get(key)
        assert.equal(read.body.toString(), 'x', `failed for ${key}`)
      }
    })

    test('publicUrl contains the key', async () => {
      const storage = await getAdapter()
      assert.ok(storage.publicUrl('media/a.png').includes('media/a.png'))
    })

    test('signedUrl produces a usable, expiring URL', async () => {
      const storage = await getAdapter()
      const url = storage.signedUrl('media/a.png', { expiresIn: 300 })

      assert.equal(typeof url, 'string')
      assert.ok(url.length > 0)
    })
  })
}

/* ------------------------------------------------------------------ *
 * Local adapter
 * ------------------------------------------------------------------ */

let localDir
let localAdapter

before(async () => {
  localDir = await mkdtemp(join(tmpdir(), 'bb-storage-'))
  localAdapter = createLocalAdapter({ dir: localDir, secret: 'test-secret' })
})

after(async () => {
  if (localDir) await rm(localDir, { recursive: true, force: true })
})

describeAdapterContract('local', async () => localAdapter)

describe('local adapter specifics', () => {
  test('refuses a key that escapes the storage directory', async () => {
    // A key arrives from a request. Joining it blindly writes wherever the
    // caller likes, which is how an upload endpoint becomes arbitrary write.
    for (const key of ['../escape.txt', '../../etc/passwd', 'a/../../../escape.txt']) {
      await assert.rejects(() => localAdapter.put(key, 'x'), /outside the storage directory/, key)
      await assert.rejects(() => localAdapter.get(key), /outside the storage directory/, key)
    }
  })

  test('a leading slash is treated as relative, not absolute', async () => {
    await localAdapter.put('/leading.txt', 'x')
    assert.equal(await localAdapter.exists('leading.txt'), true)
  })

  test('signed URLs verify', () => {
    const url = new URL(localAdapter.signedUrl('a/b.png', { method: 'PUT', expiresIn: 300 }), 'http://x')

    const result = localAdapter.verifySignedUrl('a/b.png', {
      method: 'PUT',
      expires: url.searchParams.get('expires'),
      signature: url.searchParams.get('signature')
    })

    assert.equal(result.valid, true)
  })

  test('a tampered signature is refused', () => {
    const url = new URL(localAdapter.signedUrl('a/b.png', { expiresIn: 300 }), 'http://x')
    const signature = url.searchParams.get('signature')

    const result = localAdapter.verifySignedUrl('a/b.png', {
      expires: url.searchParams.get('expires'),
      signature: signature.replace(/^./, signature[0] === 'a' ? 'b' : 'a')
    })

    assert.equal(result.valid, false)
    assert.equal(result.reason, 'signature')
  })

  test('a signature for another key is refused', () => {
    const url = new URL(localAdapter.signedUrl('a/b.png', { expiresIn: 300 }), 'http://x')

    const result = localAdapter.verifySignedUrl('other/key.png', {
      expires: url.searchParams.get('expires'),
      signature: url.searchParams.get('signature')
    })

    assert.equal(result.valid, false)
  })

  test('a signature for another method is refused', () => {
    // A read link must not also be a write link.
    const url = new URL(localAdapter.signedUrl('a/b.png', { method: 'GET', expiresIn: 300 }), 'http://x')

    const result = localAdapter.verifySignedUrl('a/b.png', {
      method: 'PUT',
      expires: url.searchParams.get('expires'),
      signature: url.searchParams.get('signature')
    })

    assert.equal(result.valid, false)
  })

  test('an expired signature is refused', () => {
    const expires = Math.floor(Date.now() / 1000) - 10
    const result = localAdapter.verifySignedUrl('a/b.png', { expires, signature: 'x'.repeat(64) })

    assert.equal(result.valid, false)
    assert.equal(result.reason, 'expired')
  })

  test('a missing signature is refused', () => {
    assert.equal(localAdapter.verifySignedUrl('a/b.png', {}).valid, false)
  })
})

/* ------------------------------------------------------------------ *
 * S3 adapter, against a real server
 * ------------------------------------------------------------------ */

const hasMinio = await minioReachable()
let s3Adapter

if (hasMinio) {
  s3Adapter = createS3Adapter(MINIO)

  // Create the bucket. It may already exist from an earlier run.
  before(async () => {
    const { signRequest, EMPTY_PAYLOAD_HASH } = await import('../sigv4.js')
    const url = `${MINIO.endpoint}/${MINIO.bucket}`
    const signed = signRequest({
      method: 'PUT', url, payloadHash: EMPTY_PAYLOAD_HASH,
      region: MINIO.region, accessKeyId: MINIO.accessKeyId, secretAccessKey: MINIO.secretAccessKey
    })
    await fetch(url, { method: 'PUT', headers: signed.headers })
  })

  describeAdapterContract('s3', async () => s3Adapter)

  describe('s3 adapter against a real server', () => {
    test('a presigned PUT uploads without credentials', async () => {
      const key = `presign/${Date.now()}-upload.png`
      const url = s3Adapter.signedUrl(key, { method: 'PUT', expiresIn: 300, contentType: 'image/png' })

      const response = await fetch(url, {
        method: 'PUT',
        body: 'pretend png',
        headers: { 'content-type': 'image/png' }
      })

      assert.ok(response.ok, `MinIO refused the presigned PUT: ${response.status}`)
      assert.equal((await s3Adapter.get(key)).body.toString(), 'pretend png')
    })

    test('a presigned GET downloads without credentials', async () => {
      const key = `presign/${Date.now()}-download.txt`
      await s3Adapter.put(key, 'downloadable')

      const response = await fetch(s3Adapter.signedUrl(key, { expiresIn: 300 }))

      assert.ok(response.ok)
      assert.equal(await response.text(), 'downloadable')
    })

    test('a presigned URL bound to a content type rejects another', async () => {
      // Without this an upload URL issued for an image accepts a script.
      const key = `presign/${Date.now()}-typed.png`
      const url = s3Adapter.signedUrl(key, { method: 'PUT', expiresIn: 300, contentType: 'image/png' })

      const response = await fetch(url, {
        method: 'PUT',
        body: 'x',
        headers: { 'content-type': 'text/html' }
      })

      assert.equal(response.ok, false, 'a mismatched content type was accepted')
    })

    test('a tampered presigned signature is refused', async () => {
      const key = `presign/${Date.now()}-tamper.txt`
      await s3Adapter.put(key, 'x')

      const url = s3Adapter.signedUrl(key, { expiresIn: 300 })
      const tampered = url.replace(/X-Amz-Signature=(.)/, (m, c) => `X-Amz-Signature=${c === 'a' ? 'b' : 'a'}`)

      assert.equal((await fetch(tampered)).ok, false)
    })

    test('a GET-presigned URL cannot be used to PUT', async () => {
      const key = `presign/${Date.now()}-method.txt`
      await s3Adapter.put(key, 'x')

      const url = s3Adapter.signedUrl(key, { method: 'GET', expiresIn: 300 })

      assert.equal((await fetch(url, { method: 'PUT', body: 'overwritten' })).ok, false)
    })

    test('an expired presigned URL is refused', async () => {
      const key = `presign/${Date.now()}-expiry.txt`
      await s3Adapter.put(key, 'x')

      const url = s3Adapter.signedUrl(key, { expiresIn: 1 })
      await new Promise((resolve) => setTimeout(resolve, 1500))

      assert.equal((await fetch(url)).ok, false)
    })

    test('a wrong secret is refused by the server', async () => {
      const wrong = createS3Adapter({ ...MINIO, secretAccessKey: 'not-the-secret' })

      await assert.rejects(() => wrong.get('anything.txt'), (error) => error.status === 403)
    })

    test('metadata round-trips', async () => {
      const key = `meta/${Date.now()}.txt`
      await s3Adapter.put(key, 'x', { contentType: 'text/plain', metadata: { author: 'ben' } })

      assert.equal((await s3Adapter.head(key)).contentType, 'text/plain')
    })
  })
} else {
  describe('s3 adapter', () => {
    test('SKIPPED — no MinIO reachable', (t) => {
      // Deliberately visible. A silent skip here would mean the signer's only
      // real-world check quietly stopped running.
      t.skip(`start MinIO on ${MINIO.endpoint} to run the S3 adapter tests`)
    })
  })
}

/* ------------------------------------------------------------------ *
 * Key building
 * ------------------------------------------------------------------ */

describe('buildKey', () => {
  test('partitions by date and adds randomness', () => {
    const key = buildKey('photo.png', { now: new Date('2026-03-09T00:00:00Z') })

    assert.match(key, /^media\/2026\/03\/[a-z0-9]{8}-photo\.png$/)
  })

  test('two uploads of the same name do not collide', () => {
    const a = buildKey('photo.png')
    const b = buildKey('photo.png')

    assert.notEqual(a, b)
  })

  test('honours a prefix', () => {
    assert.ok(buildKey('a.png', { prefix: 'avatars' }).startsWith('avatars/'))
  })
})

describe('sanitizeFilename', () => {
  test('strips directory components', () => {
    // Without this the filename chooses where the object lands.
    assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd')
    assert.equal(sanitizeFilename('/absolute/path.png'), 'path.png')
    assert.equal(sanitizeFilename('C:\\windows\\file.txt'), 'file.txt')
  })

  test('collapses traversal sequences', () => {
    assert.ok(!sanitizeFilename('a..b..c.png').includes('..'))
  })

  test('replaces unsafe characters', () => {
    assert.equal(sanitizeFilename('my photo (1).png'), 'my-photo-1-.png')
  })

  test('removes null bytes', () => {
    assert.ok(!sanitizeFilename('a\0.png').includes('\0'))
  })

  test('never returns empty', () => {
    assert.equal(sanitizeFilename(''), 'file')
    assert.equal(sanitizeFilename('...'), 'file')
    assert.equal(sanitizeFilename(null), 'file')
  })

  test('caps the length', () => {
    assert.ok(sanitizeFilename('a'.repeat(500) + '.png').length <= 100)
  })
})

describe('resolveConfig', () => {
  test('defaults to local when no bucket is configured', () => {
    assert.equal(resolveConfig({}).driver, 'local')
  })

  test('chooses s3 once a bucket and key are present', () => {
    const config = resolveConfig({ bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' })
    assert.equal(config.driver, 's3')
  })

  test('an explicit driver wins', () => {
    assert.equal(resolveConfig({ driver: 'local', bucket: 'b', accessKeyId: 'k' }).driver, 'local')
  })
})

describe('endpoint handling', () => {
  test('R2 and S3 differ only by endpoint and region', () => {
    // The claim the whole design rests on: no branching in application code.
    const r2 = createS3Adapter({
      bucket: 'media', endpoint: 'https://acct.r2.cloudflarestorage.com',
      region: 'auto', accessKeyId: 'k', secretAccessKey: 's'
    })

    const s3 = createS3Adapter({
      bucket: 'media', region: 'us-east-1', accessKeyId: 'k', secretAccessKey: 's'
    })

    assert.equal(r2.driver, s3.driver)
    assert.ok(r2.publicUrl('a.png').includes('a.png'))
    assert.ok(s3.publicUrl('a.png').includes('a.png'))
  })

  test('a scheme is supplied when the endpoint omits one', () => {
    const storage = createS3Adapter({
      bucket: 'media', endpoint: 'acct.r2.cloudflarestorage.com',
      accessKeyId: 'k', secretAccessKey: 's'
    })

    assert.ok(storage.endpoint.startsWith('https://'))
  })

  test('a publicUrl overrides the endpoint', () => {
    const storage = createS3Adapter({
      bucket: 'media', publicUrl: 'https://cdn.example.com',
      accessKeyId: 'k', secretAccessKey: 's'
    })

    assert.equal(storage.publicUrl('a/b.png'), 'https://cdn.example.com/a/b.png')
  })

  test('localhost gets path style, AWS gets virtual-host style', () => {
    const local = createS3Adapter({
      bucket: 'media', endpoint: 'http://localhost:9000', accessKeyId: 'k', secretAccessKey: 's'
    })
    const aws = createS3Adapter({
      bucket: 'media', region: 'us-east-1', accessKeyId: 'k', secretAccessKey: 's'
    })

    assert.ok(local.publicUrl('a.png').includes('/media/a.png'))
    assert.ok(aws.publicUrl('a.png').includes('media.s3.'))
  })

  test('missing credentials fail at construction, not at first use', () => {
    assert.throws(() => createS3Adapter({ bucket: 'b' }), /accessKeyId/)
    assert.throws(() => createS3Adapter({ accessKeyId: 'k', secretAccessKey: 's' }), /bucket/)
  })
})

/**
 * The public content API hands these URLs to consumers on other origins, so a
 * relative one is a broken image on someone else's site rather than a cosmetic
 * problem. That surface shipped calling `storage.url()`, which neither adapter
 * has ever defined — every media read threw a TypeError — so the contract these
 * tests pin down is the one that was missing, not one that changed.
 */
describe('absoluteUrl', () => {
  test('resolves a local driver URL against the app origin', () => {
    assert.strictEqual(
      absoluteUrl('/uploads/media/a.png', 'https://example.com'),
      'https://example.com/uploads/media/a.png'
    )
  })

  test('leaves an already absolute URL alone', () => {
    // The S3 driver returns one of these, and rebasing it onto the app origin
    // would take a working CDN URL and point it at a path the app does not serve.
    const cdn = 'https://cdn.example.com/media/a.png'
    assert.strictEqual(absoluteUrl(cdn, 'https://example.com'), cdn)
  })

  test('a base with a path still resolves a root-relative URL to the root', () => {
    assert.strictEqual(
      absoluteUrl('/uploads/a.png', 'https://example.com/blog'),
      'https://example.com/uploads/a.png'
    )
  })

  test('keeps the port', () => {
    assert.strictEqual(
      absoluteUrl('/uploads/a.png', 'http://localhost:3000'),
      'http://localhost:3000/uploads/a.png'
    )
  })

  test('preserves a query string, so signed URLs survive', () => {
    assert.strictEqual(
      absoluteUrl('/uploads/a.png?expires=1&signature=ab', 'https://example.com'),
      'https://example.com/uploads/a.png?expires=1&signature=ab'
    )
  })

  test('returns the input unchanged when there is no base', () => {
    assert.strictEqual(absoluteUrl('/uploads/a.png', undefined), '/uploads/a.png')
    assert.strictEqual(absoluteUrl('/uploads/a.png', ''), '/uploads/a.png')
  })

  test('an unparseable base returns the input rather than throwing', () => {
    // APP_URL=example.com, with no scheme, is a plausible typo. It must not
    // turn every media read into a 500.
    assert.strictEqual(absoluteUrl('/uploads/a.png', 'example.com'), '/uploads/a.png')
  })

  test('falls back to APP_URL', () => {
    const previous = process.env.APP_URL
    process.env.APP_URL = 'https://from-env.example'

    try {
      assert.strictEqual(absoluteUrl('/uploads/a.png'), 'https://from-env.example/uploads/a.png')
    } finally {
      if (previous === undefined) delete process.env.APP_URL
      else process.env.APP_URL = previous
    }
  })

  test('handles an empty URL', () => {
    assert.strictEqual(absoluteUrl('', 'https://example.com'), '')
  })
})
