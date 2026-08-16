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
