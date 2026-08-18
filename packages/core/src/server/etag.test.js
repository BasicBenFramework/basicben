/**
 * Conditional request tests.
 *
 * The interesting cases are the ones that make caching silently useless rather
 * than visibly broken: a weak tag that never matches its own strong form, a
 * sub-second mtime that always looks newer than the timestamp just sent, and a
 * 304 still advertising a Content-Length it is not going to send.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { strongEtag, weakEtag, isFresh, conditional, parseRange } from './etag.js'

/** Minimal request/response doubles — only the surface these functions touch. */
function request(headers = {}) {
  return { headers }
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    ended: false,
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value
    },
    removeHeader(name) {
      delete this.headers[name]
    },
    end(body) {
      this.ended = true
      this.body = body
    }
  }
}

describe('strongEtag', () => {
  test('is stable and quoted', () => {
    assert.strictEqual(strongEtag('hello'), strongEtag('hello'))
    assert.match(strongEtag('hello'), /^"[0-9a-f]+-.+"$/)
  })

  test('differs for different bodies', () => {
    assert.notStrictEqual(strongEtag('hello'), strongEtag('hellp'))
  })

  test('treats a Buffer and its string form alike', () => {
    assert.strictEqual(strongEtag(Buffer.from('hello')), strongEtag('hello'))
  })
})

describe('weakEtag', () => {
  test('is W/ prefixed and derived from size and mtime', () => {
    const tag = weakEtag({ size: 16, mtime: new Date(1000) })

    assert.ok(tag.startsWith('W/"'))
    assert.strictEqual(tag, weakEtag({ size: 16, mtime: new Date(1000) }))
    assert.notStrictEqual(tag, weakEtag({ size: 17, mtime: new Date(1000) }))
  })
})

describe('isFresh', () => {
  test('matches an exact tag', () => {
    assert.strictEqual(isFresh(request({ 'if-none-match': '"abc"' }), { etag: '"abc"' }), true)
  })

  test('compares weakly, so W/ matches its strong form', () => {
    // The reason this matters: serveStatic sends a weak tag, and an
    // intermediary may hand it back without the prefix. Strong comparison here
    // would re-send the whole file every time and look like caching failure.
    assert.strictEqual(isFresh(request({ 'if-none-match': '"abc"' }), { etag: 'W/"abc"' }), true)
    assert.strictEqual(isFresh(request({ 'if-none-match': 'W/"abc"' }), { etag: '"abc"' }), true)
  })

  test('matches one tag out of a list', () => {
    const req = request({ 'if-none-match': '"one", W/"two", "three"' })

    assert.strictEqual(isFresh(req, { etag: '"two"' }), true)
    assert.strictEqual(isFresh(req, { etag: '"four"' }), false)
  })

  test('* matches anything', () => {
    assert.strictEqual(isFresh(request({ 'if-none-match': '*' }), { etag: '"abc"' }), true)
  })

  test('a mismatched tag is not fresh', () => {
    assert.strictEqual(isFresh(request({ 'if-none-match': '"abc"' }), { etag: '"xyz"' }), false)
  })

  test('If-Modified-Since is honoured when no tag is sent', () => {
    const lastModified = new Date('2026-01-01T00:00:00Z')

    assert.strictEqual(
      isFresh(request({ 'if-modified-since': 'Thu, 01 Jan 2026 00:00:00 GMT' }), { lastModified }),
      true
    )
    assert.strictEqual(
      isFresh(request({ 'if-modified-since': 'Wed, 31 Dec 2025 00:00:00 GMT' }), { lastModified }),
      false
    )
  })

  test('sub-second mtimes still cache', () => {
    // HTTP dates carry whole seconds. Without flooring, a file modified at
    // .500 is always "newer" than the timestamp derived from it, so a resource
    // sends its own Last-Modified back and is told it is stale — forever.
    const lastModified = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 500))

    assert.strictEqual(
      isFresh(request({ 'if-modified-since': 'Thu, 01 Jan 2026 00:00:00 GMT' }), { lastModified }),
      true
    )
  })

  test('If-None-Match wins over If-Modified-Since', () => {
    // RFC 9110: when both are present, the entity tag decides.
    const req = request({
      'if-none-match': '"stale"',
      'if-modified-since': 'Thu, 01 Jan 2100 00:00:00 GMT'
    })

    assert.strictEqual(
      isFresh(req, { etag: '"current"', lastModified: new Date('2026-01-01') }),
      false
    )
  })

  test('an unparseable date is not fresh', () => {
    assert.strictEqual(
      isFresh(request({ 'if-modified-since': 'not a date' }), { lastModified: new Date() }),
      false
    )
  })

  test('no validators means not fresh', () => {
    assert.strictEqual(isFresh(request(), { etag: '"abc"' }), false)
  })
})

describe('conditional', () => {
  test('sets validators and returns false when stale', () => {
    const res = response()
    const sent = conditional(request(), res, {
      etag: '"abc"',
      lastModified: new Date('2026-01-01T00:00:00Z'),
      cacheControl: 'public, max-age=60'
    })

    assert.strictEqual(sent, false)
    assert.strictEqual(res.headers.ETag, '"abc"')
    assert.strictEqual(res.headers['Cache-Control'], 'public, max-age=60')
    assert.ok(res.headers['Last-Modified'])
    assert.strictEqual(res.ended, false)
  })

  test('ends with a bodyless 304 when fresh', () => {
    const res = response()
    res.setHeader('Content-Length', '1234')

    const sent = conditional(request({ 'if-none-match': '"abc"' }), res, { etag: '"abc"' })

    assert.strictEqual(sent, true)
    assert.strictEqual(res.statusCode, 304)
    assert.strictEqual(res.ended, true)
    assert.strictEqual(res.body, undefined)
    // A 304 promising bytes it will not send leaves clients waiting.
    assert.strictEqual(res.headers['Content-Length'], undefined)
  })
})

describe('parseRange', () => {
  test('a closed range', () => {
    assert.deepStrictEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 })
  })

  test('an open-ended range runs to the last byte', () => {
    assert.deepStrictEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 })
  })

  test('an end past the entity is clamped', () => {
    assert.deepStrictEqual(parseRange('bytes=990-5000', 1000), { start: 990, end: 999 })
  })

  test('a suffix range counts back from the end', () => {
    assert.deepStrictEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 })
  })

  test('a suffix longer than the entity is the whole entity', () => {
    assert.deepStrictEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 })
  })

  test('a start past the end is unsatisfiable', () => {
    assert.deepStrictEqual(parseRange('bytes=1000-', 1000), { unsatisfiable: true })
    assert.deepStrictEqual(parseRange('bytes=900-100', 1000), { unsatisfiable: true })
    assert.deepStrictEqual(parseRange('bytes=-0', 1000), { unsatisfiable: true })
  })

  test('absent, malformed and multi-range all mean "send everything"', () => {
    assert.strictEqual(parseRange(undefined, 1000), null)
    assert.strictEqual(parseRange('items=0-99', 1000), null)
    assert.strictEqual(parseRange('bytes=abc', 1000), null)
    assert.strictEqual(parseRange('bytes=-', 1000), null)
    // Multipart byteranges is deliberately unimplemented; the whole entity is a
    // valid answer to a range request and every client handles it.
    assert.strictEqual(parseRange('bytes=0-99,200-299', 1000), null)
  })
})
