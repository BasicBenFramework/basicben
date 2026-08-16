/**
 * Local upload receiver tests.
 *
 * This endpoint accepts a PUT and writes it to disk, so the signature check is
 * the only thing standing between it and arbitrary file write. It is tested
 * against a real HTTP server rather than by calling the middleware directly,
 * because what matters is the behaviour over the wire — including that the body
 * is streamed rather than buffered.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localUploadReceiver } from './local-upload.js'
import { createLocalAdapter } from './adapters/local.js'

const SECRET = 'receiver-test-secret'

let dir
let server
let baseUrl
let adapter

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bb-receiver-'))
  adapter = createLocalAdapter({ dir, secret: SECRET })

  const receiver = localUploadReceiver({ dir, secret: SECRET, maxSize: 1024, adapter })

  server = createServer((req, res) => {
    receiver(req, res, () => {
      res.statusCode = 404
      res.end('not handled')
    })
  })

  await new Promise((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  if (dir) await rm(dir, { recursive: true, force: true })
})

/** Turn the adapter's relative signed URL into an absolute one. */
const signedFor = (key, options) => `${baseUrl}${adapter.signedUrl(key, { method: 'PUT', ...options })}`

describe('local upload receiver', () => {
  test('accepts a correctly signed PUT and writes the bytes', async () => {
    const response = await fetch(signedFor('a/photo.png', { expiresIn: 300 }), {
      method: 'PUT',
      body: 'file contents'
    })

    assert.equal(response.status, 200)
    assert.equal(await readFile(join(dir, 'a/photo.png'), 'utf8'), 'file contents')
  })

  test('binary content is written unchanged', async () => {
    // The body parser this runs ahead of would have decoded these as utf8 and
    // corrupted them, which is the bug that made the old upload path unusable.
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80])

    await fetch(signedFor('a/binary.png', { expiresIn: 300 }), { method: 'PUT', body: bytes })

    assert.deepEqual([...(await readFile(join(dir, 'a/binary.png')))], [...bytes])
  })

  test('refuses an unsigned PUT', async () => {
    // Without this the endpoint is an arbitrary file write.
    const response = await fetch(`${baseUrl}/uploads/unsigned.png`, { method: 'PUT', body: 'x' })

    assert.equal(response.status, 403)
    assert.equal(existsSync(join(dir, 'unsigned.png')), false)
  })

  test('refuses a tampered signature', async () => {
    const url = signedFor('a/tampered.png', { expiresIn: 300 })
    const broken = url.replace(/signature=(.)/, (m, c) => `signature=${c === 'a' ? 'b' : 'a'}`)

    const response = await fetch(broken, { method: 'PUT', body: 'x' })

    assert.equal(response.status, 403)
    assert.equal(existsSync(join(dir, 'a/tampered.png')), false)
  })

  test('a signature for one key cannot write another', async () => {
    const url = new URL(signedFor('a/allowed.png', { expiresIn: 300 }))
    const swapped = `${baseUrl}/uploads/a/forbidden.png${url.search}`

    const response = await fetch(swapped, { method: 'PUT', body: 'x' })

    assert.equal(response.status, 403)
    assert.equal(existsSync(join(dir, 'a/forbidden.png')), false)
  })

  test('refuses an expired signature', async () => {
    const url = new URL(signedFor('a/expired.png', { expiresIn: 300 }))
    url.searchParams.set('expires', String(Math.floor(Date.now() / 1000) - 60))

    const response = await fetch(url, { method: 'PUT', body: 'x' })

    assert.equal(response.status, 403)
    assert.equal(existsSync(join(dir, 'a/expired.png')), false)
  })

  test('a GET-signed URL cannot be used to PUT', async () => {
    const url = `${baseUrl}${adapter.signedUrl('a/getonly.png', { method: 'GET', expiresIn: 300 })}`

    const response = await fetch(url, { method: 'PUT', body: 'x' })

    assert.equal(response.status, 403)
  })

  test('rejects a body over the limit and leaves nothing behind', async () => {
    const response = await fetch(signedFor('a/big.png', { expiresIn: 300 }), {
      method: 'PUT',
      body: 'x'.repeat(4096)
    })

    assert.equal(response.status, 413)
    assert.equal(existsSync(join(dir, 'a/big.png')), false, 'the oversized file was left on disk')
  })

  test('a key escaping the storage directory is refused', async () => {
    // The signature already implies the key is one this server issued, but a
    // signing-scheme change must not be able to turn into arbitrary write.
    const key = '../escape.png'
    const url = `${baseUrl}${adapter.signedUrl(key, { method: 'PUT', expiresIn: 300 })}`

    const response = await fetch(url, { method: 'PUT', body: 'x' })

    assert.ok(response.status >= 400, `escape was accepted with ${response.status}`)
    assert.equal(existsSync(join(dir, '../escape.png')), false)
  })

  test('leaves other methods and paths alone', async () => {
    assert.equal((await fetch(`${baseUrl}/uploads/x.png`)).status, 404)
    assert.equal((await fetch(`${baseUrl}/api/other`, { method: 'PUT', body: 'x' })).status, 404)
  })
})
