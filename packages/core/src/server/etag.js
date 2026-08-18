/**
 * Conditional requests: ETag, Last-Modified, and Range.
 *
 * The framework already sent `Last-Modified` on static files and then ignored
 * the `If-Modified-Since` that browsers sent back, so every conditional request
 * was answered with the whole body — the header was advice nobody took. Media
 * could not be seeked or resumed either, because a `Range` request got a 200
 * and the entire file.
 *
 * Comparison follows RFC 9110: `If-None-Match` uses *weak* comparison, so
 * `W/"abc"` and `"abc"` match. That matters because a validator good enough to
 * say "unchanged for caching" is not the same as one good enough to splice byte
 * ranges together, and only the second needs to be strong.
 */

import { createHash } from 'node:crypto'

/**
 * A strong ETag for a body you already have in memory.
 *
 * Strong because it is a hash of the exact bytes: two responses with this tag
 * are byte-identical, which is what lets a range request use it.
 *
 * @param {string|Buffer} body
 * @returns {string} quoted entity-tag
 */
export function strongEtag(body) {
  const hash = createHash('sha1').update(body).digest('base64').slice(0, 27)

  return `"${Buffer.byteLength(body).toString(16)}-${hash}"`
}

/**
 * A weak ETag for a file, from its size and modification time.
 *
 * Weak because it does not read the file: two files with the same size and
 * mtime are treated as the same entity, which is right for caching and wrong
 * for byte ranges. Hashing every static file on every request would be the
 * alternative, and it is not worth it.
 *
 * @param {{ size: number, mtime: Date }} stat
 * @returns {string} quoted entity-tag, W/ prefixed
 */
export function weakEtag(stat) {
  return `W/"${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`
}

/** Strip the weak prefix so two tags can be compared weakly. */
function withoutWeakPrefix(tag) {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}

/**
 * Whether the client's cached copy is still good.
 *
 * `If-None-Match` wins outright when present — an entity tag is a better
 * validator than a timestamp with one-second resolution, and RFC 9110 says to
 * ignore `If-Modified-Since` when both are sent.
 *
 * @param {Object} req - incoming request
 * @param {Object} validators
 * @param {string} [validators.etag]
 * @param {Date} [validators.lastModified]
 * @returns {boolean}
 */
export function isFresh(req, { etag, lastModified } = {}) {
  const noneMatch = req.headers['if-none-match']

  if (noneMatch) {
    if (noneMatch.trim() === '*') return true
    if (!etag) return false

    const wanted = withoutWeakPrefix(etag)

    return noneMatch
      .split(',')
      .map((tag) => withoutWeakPrefix(tag.trim()))
      .includes(wanted)
  }

  const modifiedSince = req.headers['if-modified-since']

  if (modifiedSince && lastModified) {
    const since = Date.parse(modifiedSince)

    if (Number.isNaN(since)) return false

    // HTTP dates have one-second resolution, so the stored mtime is floored
    // before comparing. Without this a file modified at .500 looks newer than
    // the very response that carried its own timestamp, and never caches.
    return Math.floor(lastModified.getTime() / 1000) * 1000 <= since
  }

  return false
}

/**
 * Set validators and answer a conditional request if the copy is fresh.
 *
 * Returns true when it has already ended the response with a 304, so the caller
 * knows not to send a body.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Object} validators
 * @param {string} [validators.etag]
 * @param {Date} [validators.lastModified]
 * @param {string} [validators.cacheControl]
 * @returns {boolean} whether a 304 was sent
 */
export function conditional(req, res, { etag, lastModified, cacheControl } = {}) {
  if (etag) res.setHeader('ETag', etag)
  if (lastModified) res.setHeader('Last-Modified', lastModified.toUTCString())
  if (cacheControl) res.setHeader('Cache-Control', cacheControl)

  if (!isFresh(req, { etag, lastModified })) return false

  // A 304 carries no body, and Content-Length must not describe one that is not
  // there — a stale length from an earlier setHeader makes clients wait for
  // bytes that never arrive.
  res.removeHeader?.('Content-Length')
  res.statusCode = 304
  res.end()

  return true
}

/**
 * Parse a Range header against a known entity size.
 *
 * Returns null when there is nothing to do (absent or unsupported), and
 * `{ unsatisfiable: true }` when the request names a range outside the entity,
 * which is a 416 rather than a 200.
 *
 * Multiple ranges in one request are deliberately not supported: answering them
 * means multipart/byteranges, which no media player needs and every one of them
 * copes without. A multi-range request gets the whole entity.
 *
 * @param {string|undefined} header
 * @param {number} size
 * @returns {{ start: number, end: number }|{ unsatisfiable: true }|null}
 */
export function parseRange(header, size) {
  if (!header || typeof header !== 'string') return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())

  if (!match) return null

  const [, rawStart, rawEnd] = match

  if (rawStart === '' && rawEnd === '') return null

  let start
  let end

  if (rawStart === '') {
    // "bytes=-500" — the final 500 bytes. A suffix longer than the entity is
    // the whole entity, not an error.
    const suffix = Number(rawEnd)

    if (suffix <= 0) return { unsatisfiable: true }

    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }

  if (start > end || start >= size) return { unsatisfiable: true }

  return { start, end }
}
