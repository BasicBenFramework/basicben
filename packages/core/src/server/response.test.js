/**
 * Tests for the response helpers
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { addResponseHelpers } from './index.js'

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    end(data) { this.body = data }
  }
  addResponseHelpers({}, res, () => {})
  return res
}

describe('res.json', () => {
  test('defaults to 200', () => {
    const res = mockRes()
    res.json({ ok: true })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.headers['content-type'], 'application/json')
    assert.deepStrictEqual(JSON.parse(res.body), { ok: true })
  })

  test('an explicit status wins', () => {
    const res = mockRes()
    res.json({ error: 'Not Found' }, 404)

    assert.strictEqual(res.statusCode, 404)
  })

  test('keeps a status already set by res.status', () => {
    const res = mockRes()
    res.status(404).json({ error: 'Not Found' })

    assert.strictEqual(res.statusCode, 404)
  })

  test('an explicit status overrides res.status', () => {
    const res = mockRes()
    res.status(500).json({ error: 'Not Found' }, 404)

    assert.strictEqual(res.statusCode, 404)
  })
})

describe('res.status', () => {
  test('is chainable', () => {
    const res = mockRes()
    assert.strictEqual(res.status(201), res)
  })
})
