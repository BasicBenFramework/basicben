/**
 * CORS tests.
 *
 * This middleware decides whether a browser will let another site read this
 * one's API, so its failure modes are either "nothing works cross-origin" or
 * "anything may read your data". Both are quiet: the first shows up only in a
 * browser console, the second not at all.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { cors } from './cors.js'

function run(options, { origin, method = 'GET' } = {}) {
  const headers = {}
  const res = {
    statusCode: 200,
    ended: false,
    setHeader(name, value) {
      headers[name] = value
    },
    end() {
      this.ended = true
    }
  }

  let nexted = false

  cors(options)({ headers: origin ? { origin } : {}, method }, res, () => {
    nexted = true
  })

  return { headers, res, nexted }
}

describe('origin allowlist', () => {
  test('an allowed origin is reflected, with Vary', () => {
    const { headers } = run(
      { origin: ['https://blog.example.com'] },
      { origin: 'https://blog.example.com' }
    )

    assert.strictEqual(headers['Access-Control-Allow-Origin'], 'https://blog.example.com')
    // Without Vary, a shared cache can serve one origin's response to another.
    assert.strictEqual(headers.Vary, 'Origin')
  })

  test('an origin not on the list gets no allow header', () => {
    const { headers } = run(
      { origin: ['https://blog.example.com'] },
      { origin: 'https://evil.example.com' }
    )

    assert.strictEqual(headers['Access-Control-Allow-Origin'], undefined)
  })

  test('a function origin decides per request', () => {
    const options = { origin: (origin) => origin?.endsWith('.example.com') }

    assert.strictEqual(
      run(options, { origin: 'https://a.example.com' }).headers['Access-Control-Allow-Origin'],
      'https://a.example.com'
    )
    assert.strictEqual(
      run(options, { origin: 'https://a.evil.com' }).headers['Access-Control-Allow-Origin'],
      undefined
    )
  })

  test('a wildcard allows anything', () => {
    const { headers } = run({ origin: '*' }, { origin: 'https://anywhere.example.com' })

    assert.strictEqual(headers['Access-Control-Allow-Origin'], '*')
  })
})

describe('credentials', () => {
  test('wildcard plus credentials drops credentials', () => {
    // Browsers reject that pairing outright, so honouring it would silently
    // break every credentialed cross-origin request. Reflecting the request
    // origin instead would turn a config mistake into "any site may make
    // credentialed calls", which is worse.
    const { headers } = run({ origin: '*', credentials: true }, { origin: 'https://x.example.com' })

    assert.strictEqual(headers['Access-Control-Allow-Origin'], '*')
    assert.strictEqual(headers['Access-Control-Allow-Credentials'], undefined)
  })

  test('an allowed origin gets credentials', () => {
    const { headers } = run(
      { origin: ['https://blog.example.com'], credentials: true },
      { origin: 'https://blog.example.com' }
    )

    assert.strictEqual(headers['Access-Control-Allow-Credentials'], 'true')
  })

  test('a refused origin does not get credentials', () => {
    // The header is meaningless without an accompanying allow-origin, and
    // sending it reads — to whoever is debugging the refusal — as a yes.
    const { headers } = run(
      { origin: ['https://blog.example.com'], credentials: true },
      { origin: 'https://evil.example.com' }
    )

    assert.strictEqual(headers['Access-Control-Allow-Credentials'], undefined)
  })
})

describe('preflight', () => {
  test('answers OPTIONS with 204 and does not continue', () => {
    const { headers, res, nexted } = run(
      { origin: ['https://blog.example.com'] },
      { origin: 'https://blog.example.com', method: 'OPTIONS' }
    )

    assert.strictEqual(res.statusCode, 204)
    assert.strictEqual(res.ended, true)
    assert.strictEqual(nexted, false, 'preflight fell through to the route')
    assert.ok(headers['Access-Control-Allow-Methods'])
    assert.ok(headers['Access-Control-Allow-Headers'])
    assert.ok(headers['Access-Control-Max-Age'])
  })

  test('a normal request continues to the route', () => {
    const { nexted } = run({ origin: '*' }, { origin: 'https://x.example.com' })

    assert.strictEqual(nexted, true)
  })
})
