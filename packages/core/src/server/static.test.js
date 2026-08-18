/**
 * Tests for the SPA history fallback
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spaFallback } from './static.js'

const INDEX_HTML = '<!doctype html><title>shell</title>'

let tmpRoot
let originalCwd

/** Minimal res double — the fallback only needs these */
function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    end(data) { if (data) this.body += data; this.ended = true },
    on() {},
    once() {},
    emit() {}
  }
}

/** Collect the streamed body, since the fallback pipes rather than ends */
function mockPipeableRes() {
  const res = mockRes()
  res.write = (chunk) => { res.body += chunk; return true }
  res.emit = () => {}
  return res
}

function run(handler, req) {
  return new Promise((resolve) => {
    const res = mockPipeableRes()
    const done = () => resolve(res)
    res.end = (data) => { if (data) res.body += data; res.ended = true; done() }
    handler(req, res)
    // piped responses finish asynchronously
    setTimeout(() => { if (!res.ended) done() }, 50)
  })
}

describe('spaFallback', () => {
  before(() => {
    originalCwd = process.cwd()
    tmpRoot = mkdtempSync(join(tmpdir(), 'basicben-spa-'))
    mkdirSync(join(tmpRoot, 'client'), { recursive: true })
    writeFileSync(join(tmpRoot, 'client', 'index.html'), INDEX_HTML)
    process.chdir(tmpRoot)
  })

  after(() => {
    process.chdir(originalCwd)
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  test('serves the shell for an unmatched client route', async () => {
    let fellThrough = false
    const handler = spaFallback({ dir: 'client', spa: true }, () => { fellThrough = true })

    const res = await run(handler, { method: 'GET', path: '/docs/routing', url: '/docs/routing' })

    assert.strictEqual(fellThrough, false)
    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.headers['content-type'], 'text/html')
  })

  test('never caches the shell', async () => {
    const handler = spaFallback({ dir: 'client', spa: true }, () => {})
    const res = await run(handler, { method: 'GET', path: '/docs', url: '/docs' })

    assert.strictEqual(res.headers['cache-control'], 'no-cache')
  })

  test('falls through for API paths', async () => {
    let fellThrough = false
    const handler = spaFallback({ dir: 'client', spa: true }, () => { fellThrough = true })

    await run(handler, { method: 'GET', path: '/api/posts', url: '/api/posts' })

    assert.strictEqual(fellThrough, true)
  })

  test('falls through for non-GET requests', async () => {
    let fellThrough = false
    const handler = spaFallback({ dir: 'client', spa: true }, () => { fellThrough = true })

    await run(handler, { method: 'POST', path: '/docs', url: '/docs' })

    assert.strictEqual(fellThrough, true)
  })

  test('falls through for missing assets so they 404 properly', async () => {
    let fellThrough = false
    const handler = spaFallback({ dir: 'client', spa: true }, () => { fellThrough = true })

    await run(handler, { method: 'GET', path: '/assets/gone.js', url: '/assets/gone.js' })

    assert.strictEqual(fellThrough, true)
  })

  test('honours a custom exclude list', async () => {
    let fellThrough = false
    const handler = spaFallback(
      { dir: 'client', spa: true, spaExclude: [/^\/api\//, /^\/webhooks\//] },
      () => { fellThrough = true }
    )

    await run(handler, { method: 'GET', path: '/webhooks/stripe', url: '/webhooks/stripe' })

    assert.strictEqual(fellThrough, true)
  })

  test('falls through when the shell does not exist', async () => {
    let fellThrough = false
    const handler = spaFallback({ dir: 'nonexistent', spa: true }, () => { fellThrough = true })

    await run(handler, { method: 'GET', path: '/docs', url: '/docs' })

    assert.strictEqual(fellThrough, true)
  })
})

describe('serveStatic conditional requests and ranges', () => {
  const BODY = 'abcdefghijklmnopqrstuvwxyz'

  let root
  let previousCwd
  let handler

  before(async () => {
    previousCwd = process.cwd()
    root = mkdtempSync(join(tmpdir(), 'basicben-static-'))
    mkdirSync(join(root, 'public'), { recursive: true })
    writeFileSync(join(root, 'public', 'file.txt'), BODY)
    process.chdir(root)

    const { serveStatic } = await import('./static.js')
    handler = serveStatic({ dir: 'public' })
  })

  after(() => {
    process.chdir(previousCwd)
    rmSync(root, { recursive: true, force: true })
  })

  const get = (headers = {}, method = 'GET') =>
    run(handler, { method, path: '/file.txt', url: '/file.txt', headers })

  test('sends an ETag and advertises range support', async () => {
    const res = await get()

    assert.ok(res.headers.etag, 'no ETag was sent')
    assert.strictEqual(res.headers['accept-ranges'], 'bytes')
    assert.strictEqual(res.body, BODY)
  })

  test('returns 304 for a matching ETag', async () => {
    // This is what was broken: Last-Modified was sent and the conditional
    // request that came back was answered with the whole file.
    const first = await get()
    const second = await get({ 'if-none-match': first.headers.etag })

    assert.strictEqual(second.statusCode, 304)
    assert.strictEqual(second.body, '')
  })

  test('returns 304 for If-Modified-Since', async () => {
    const first = await get()
    const res = await get({ 'if-modified-since': first.headers['last-modified'] })

    assert.strictEqual(res.statusCode, 304)
    assert.strictEqual(res.body, '')
  })

  test('a stale validator still gets the body', async () => {
    const res = await get({ 'if-none-match': '"not-the-tag"' })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.body, BODY)
  })

  test('serves a byte range as 206', async () => {
    const res = await get({ range: 'bytes=0-4' })

    assert.strictEqual(res.statusCode, 206)
    assert.strictEqual(res.body, 'abcde')
    assert.strictEqual(res.headers['content-range'], `bytes 0-4/${BODY.length}`)
    assert.strictEqual(res.headers['content-length'], 5)
  })

  test('serves a suffix range', async () => {
    const res = await get({ range: 'bytes=-3' })

    assert.strictEqual(res.statusCode, 206)
    assert.strictEqual(res.body, 'xyz')
  })

  test('an unsatisfiable range is 416', async () => {
    const res = await get({ range: `bytes=${BODY.length + 10}-` })

    assert.strictEqual(res.statusCode, 416)
    assert.strictEqual(res.headers['content-range'], `bytes */${BODY.length}`)
  })

  test('a HEAD request sends headers and no body', async () => {
    const res = await get({}, 'HEAD')

    assert.strictEqual(res.body, '')
    assert.strictEqual(res.headers['content-length'], BODY.length)
  })
})
