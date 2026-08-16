/**
 * AWS Signature Version 4.
 *
 * ## Why this is hand-written
 *
 * `@aws-sdk/client-s3` is tens of megabytes of dependency for what is, at the
 * bottom, one HMAC chain and a string-building exercise. Both primitives are in
 * `node:crypto` already. The framework ships no runtime dependencies, and this
 * is not the place to start.
 *
 * A hand-rolled signer is only defensible if it is verified against something
 * outside itself, so it is checked two ways: the 34 published AWS test vectors
 * in `sigv4.test.js`, which pin every stage of the algorithm, and a real MinIO
 * server in the smoke test, which is the only thing that proves a signature an
 * actual S3 implementation will accept.
 *
 * ## S3 is not like the other services
 *
 * Two divergences, and both produce signatures that verify locally and are
 * rejected by S3:
 *
 *   - S3 does **not** normalize the path. Every other service resolves `.` and
 *     `..` and collapses `//` before signing; S3 signs the path as given,
 *     because an object key may legitimately contain those sequences and
 *     rewriting it would sign a different object than the one requested.
 *   - S3 accepts `UNSIGNED-PAYLOAD` in place of a body hash, which is what
 *     makes presigned uploads possible at all — the signer never sees the bytes.
 *
 * ## Portability
 *
 * The two primitives are isolated at the top of the file. Swapping them for Web
 * Crypto is what a Workers build would need, and nothing else here touches a
 * Node API.
 */

import { createHash, createHmac } from 'node:crypto'

const ALGORITHM = 'AWS4-HMAC-SHA256'

/** SHA-256, hex. Isolated for portability. */
const sha256Hex = (data) => createHash('sha256').update(data).digest('hex')

/** HMAC-SHA256, raw bytes. Isolated for portability. */
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

/** The hash of an empty body, which appears in most GET signatures. */
export const EMPTY_PAYLOAD_HASH = sha256Hex('')

/** Tells S3 to sign everything except the body. */
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

/**
 * Percent-encode per RFC 3986.
 *
 * `encodeURIComponent` is close but not the same: it leaves `!'()*` alone,
 * which AWS expects encoded, and it will not conditionally preserve `/`.
 *
 * @param {string} value
 * @param {boolean} [encodeSlash] - false when encoding a path
 * @returns {string}
 */
export function uriEncode(value, encodeSlash = true) {
  let out = ''

  for (const byte of new TextEncoder().encode(String(value))) {
    const char = String.fromCharCode(byte)

    if ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) ||
        (byte >= 0x30 && byte <= 0x39) || char === '-' || char === '_' ||
        char === '.' || char === '~') {
      out += char
    } else if (char === '/' && !encodeSlash) {
      out += char
    } else {
      out += '%' + byte.toString(16).toUpperCase().padStart(2, '0')
    }
  }

  return out
}

/**
 * Resolve `.` and `..` and collapse repeated slashes.
 *
 * Not applied for S3 — see the note at the top of this file.
 *
 * @param {string} path
 * @returns {string}
 */
export function normalizePath(path) {
  const segments = []

  for (const segment of String(path).split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') { segments.pop(); continue }
    segments.push(segment)
  }

  const trailingSlash = path.endsWith('/') && segments.length > 0 ? '/' : ''

  return `/${segments.join('/')}${trailingSlash}`
}

/**
 * Build the canonical URI.
 *
 * @param {string} path
 * @param {string} service
 * @returns {string}
 */
export function canonicalUri(path, service) {
  if (!path || path === '') return '/'

  // S3 signs the key it was given. Normalizing here would sign a different
  // object than the request asks for whenever a key contains "." or "//".
  const resolved = service === 's3' ? path : normalizePath(path)

  return uriEncode(resolved, false)
}

/**
 * Build the canonical query string.
 *
 * Sorted by the **encoded** key and then the encoded value, which is not the
 * same order as sorting the decoded ones — `%E1%88%B4` sorts before `Param`
 * encoded, and after it decoded.
 *
 * @param {string|URLSearchParams} query
 * @returns {string}
 */
export function canonicalQuery(query) {
  if (!query) return ''

  const pairs = []
  const source = typeof query === 'string'
    ? query.replace(/^\?/, '').split('&').filter(Boolean).map((part) => {
        const eq = part.indexOf('=')
        return eq === -1
          ? [safeDecode(part), '']
          : [safeDecode(part.slice(0, eq)), safeDecode(part.slice(eq + 1))]
      })
    : [...query.entries()]

  for (const [key, value] of source) {
    pairs.push([uriEncode(key), uriEncode(value)])
  }

  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))

  return pairs.map(([key, value]) => `${key}=${value}`).join('&')
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/**
 * Canonicalize headers.
 *
 * Values are trimmed and their internal whitespace collapsed, so a header sent
 * as `"a   b"` signs as `"a b"` — servers normalize the same way, and not doing
 * it produces a signature mismatch that is invisible in the request.
 *
 * @param {Object} headers
 * @returns {{ canonical: string, signed: string }}
 */
export function canonicalHeaders(headers) {
  const collected = new Map()

  for (const [name, value] of Object.entries(headers || {})) {
    if (value === undefined || value === null) continue

    const key = name.toLowerCase().trim()
    const normalized = String(value).trim().replace(/\s+/g, ' ')

    // Repeated headers are joined in the order they were given.
    collected.set(key, collected.has(key) ? `${collected.get(key)},${normalized}` : normalized)
  }

  const sorted = [...collected.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  return {
    canonical: sorted.map(([key, value]) => `${key}:${value}\n`).join(''),
    signed: sorted.map(([key]) => key).join(';')
  }
}

/**
 * Build the canonical request — the first of the algorithm's three stages.
 *
 * @param {Object} options
 * @returns {{ canonical: string, signedHeaders: string }}
 */
export function canonicalRequest({ method, path, query, headers, payloadHash, service = 's3' }) {
  const { canonical: headerLines, signed } = canonicalHeaders(headers)

  const canonical = [
    String(method).toUpperCase(),
    canonicalUri(path, service),
    canonicalQuery(query),
    headerLines,
    signed,
    payloadHash
  ].join('\n')

  return { canonical, signedHeaders: signed }
}

/**
 * Build the string to sign — the second stage.
 *
 * @param {Object} options
 * @returns {string}
 */
export function stringToSign({ canonical, timestamp, region, service = 's3' }) {
  return [
    ALGORITHM,
    timestamp,
    `${timestamp.slice(0, 8)}/${region}/${service}/aws4_request`,
    sha256Hex(canonical)
  ].join('\n')
}

/**
 * Derive the signing key — the third stage.
 *
 * Four chained HMACs, each keyed by the previous result. The chain is what
 * scopes a key to one day, one region and one service, so a leaked signature
 * cannot be replayed against another.
 *
 * @param {Object} options
 * @returns {Buffer}
 */
export function signingKey({ secretAccessKey, date, region, service = 's3' }) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, date)
  const regionKey = hmac(dateKey, region)
  const serviceKey = hmac(regionKey, service)

  return hmac(serviceKey, 'aws4_request')
}

/**
 * Format a Date as the compact ISO form AWS expects.
 *
 * @param {Date} [date]
 * @returns {string} e.g. 20150830T123600Z
 */
export function amzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

/**
 * Sign a request, returning the headers to send with it.
 *
 * @param {Object} options
 * @param {string} options.method
 * @param {string} options.url
 * @param {string} options.region
 * @param {string} [options.service]
 * @param {string} options.accessKeyId
 * @param {string} options.secretAccessKey
 * @param {string} [options.sessionToken]
 * @param {Object} [options.headers]
 * @param {string} [options.payloadHash]
 * @param {string} [options.timestamp]
 * @returns {{ headers: Object, authorization: string, signature: string, canonical: string, stringToSign: string }}
 */
export function signRequest({
  method,
  url,
  region,
  service = 's3',
  accessKeyId,
  secretAccessKey,
  sessionToken,
  headers = {},
  payloadHash = EMPTY_PAYLOAD_HASH,
  timestamp = amzDate()
}) {
  const parsed = new URL(url)
  const date = timestamp.slice(0, 8)

  // The host header is part of the signature, so it has to be the one the
  // request will actually carry — including the port when non-default.
  const signedHeaderSet = {
    host: parsed.host,
    'x-amz-date': timestamp,
    'x-amz-content-sha256': payloadHash,
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
    ...headers
  }

  const { canonical, signedHeaders } = canonicalRequest({
    method,
    path: decodeURIComponent(parsed.pathname),
    query: parsed.search,
    headers: signedHeaderSet,
    payloadHash,
    service
  })

  const toSign = stringToSign({ canonical, timestamp, region, service })
  const key = signingKey({ secretAccessKey, date, region, service })
  const signature = hmac(key, toSign).toString('hex')

  const authorization =
    `${ALGORITHM} Credential=${accessKeyId}/${date}/${region}/${service}/aws4_request, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    headers: { ...signedHeaderSet, authorization },
    authorization,
    signature,
    signedHeaders,
    canonical,
    stringToSign: toSign
  }
}

/**
 * Build a presigned URL.
 *
 * Everything the signature covers moves into the query string, so the URL can
 * be handed to a browser and used with no credentials and no further headers.
 * That is what lets a file go straight from the browser to the bucket without
 * passing through this server.
 *
 * @param {Object} options
 * @param {string} options.method - the method the holder will use, and only that one
 * @param {string} options.url
 * @param {string} options.region
 * @param {string} [options.service]
 * @param {string} options.accessKeyId
 * @param {string} options.secretAccessKey
 * @param {string} [options.sessionToken]
 * @param {number} [options.expiresIn] - seconds, max 604800 (7 days)
 * @param {Object} [options.headers] - extra headers the holder must send
 * @param {string} [options.payloadHash]
 * @param {string} [options.timestamp]
 * @returns {string}
 */
export function presignUrl({
  method = 'GET',
  url,
  region,
  service = 's3',
  accessKeyId,
  secretAccessKey,
  sessionToken,
  expiresIn = 900,
  headers = {},
  payloadHash = UNSIGNED_PAYLOAD,
  timestamp = amzDate()
}) {
  if (expiresIn < 1 || expiresIn > 604800) {
    throw new Error('expiresIn must be between 1 second and 7 days (604800 seconds)')
  }

  const parsed = new URL(url)
  const date = timestamp.slice(0, 8)

  // Host is always signed; anything else the holder must send has to be signed
  // too, or S3 will reject the request for a header it did not expect.
  const signedHeaderSet = { host: parsed.host, ...headers }
  const { signed } = canonicalHeaders(signedHeaderSet)

  const query = new URLSearchParams(parsed.search)
  query.set('X-Amz-Algorithm', ALGORITHM)
  query.set('X-Amz-Credential', `${accessKeyId}/${date}/${region}/${service}/aws4_request`)
  query.set('X-Amz-Date', timestamp)
  query.set('X-Amz-Expires', String(expiresIn))
  query.set('X-Amz-SignedHeaders', signed)
  if (sessionToken) query.set('X-Amz-Security-Token', sessionToken)

  const { canonical } = canonicalRequest({
    method,
    path: decodeURIComponent(parsed.pathname),
    query,
    headers: signedHeaderSet,
    payloadHash,
    service
  })

  const toSign = stringToSign({ canonical, timestamp, region, service })
  const key = signingKey({ secretAccessKey, date, region, service })
  const signature = hmac(key, toSign).toString('hex')

  return `${parsed.origin}${parsed.pathname}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`
}

/**
 * Hash a request body.
 *
 * @param {string|Buffer|Uint8Array} body
 * @returns {string}
 */
export function hashPayload(body) {
  if (body === undefined || body === null || body === '') return EMPTY_PAYLOAD_HASH
  return sha256Hex(body)
}
