/**
 * S3-compatible storage.
 *
 * One adapter, not two. R2 speaks the S3 API, and so do MinIO, Backblaze B2 and
 * DigitalOcean Spaces — the difference between them is an endpoint and a region
 * string, which is configuration rather than code. Writing an "R2 driver" and an
 * "S3 driver" would be two copies of this file that drift apart.
 *
 * Requests are signed with `../sigv4.js` and sent with `fetch`. No SDK: the
 * operations a CMS needs are five HTTP verbs against a URL.
 */

import { signRequest, presignUrl, hashPayload, UNSIGNED_PAYLOAD, EMPTY_PAYLOAD_HASH } from '../sigv4.js'

/**
 * @param {Object} config
 * @param {string} config.bucket
 * @param {string} [config.endpoint] - omit for AWS S3
 * @param {string} [config.region] - 'auto' for R2
 * @param {string} config.accessKeyId
 * @param {string} config.secretAccessKey
 * @param {string} [config.sessionToken]
 * @param {string} [config.publicUrl] - CDN or custom domain
 * @param {boolean} [config.forcePathStyle] - inferred when not set
 * @returns {Object} storage adapter
 */
export function createS3Adapter(config = {}) {
  const bucket = config.bucket
  if (!bucket) throw new Error('S3 storage requires a bucket')
  if (!config.accessKeyId || !config.secretAccessKey) {
    throw new Error('S3 storage requires accessKeyId and secretAccessKey')
  }

  const region = config.region || 'us-east-1'
  const endpoint = normalizeEndpoint(config.endpoint) || `https://s3.${region}.amazonaws.com`

  // Virtual-host style (bucket.endpoint) is what AWS and R2 prefer; path style
  // (endpoint/bucket) is what MinIO and a local dev server need. Guessing from
  // the hostname is right often enough, and forcePathStyle overrides it.
  const forcePathStyle = config.forcePathStyle ?? inferPathStyle(endpoint)

  const credentials = {
    region: region === 'auto' ? 'auto' : region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken
  }

  /** Build the URL for a key. */
  const urlFor = (key = '', query = '') => {
    const base = new URL(endpoint)
    const encoded = encodeKey(key)

    const path = forcePathStyle
      ? `/${bucket}${encoded ? `/${encoded}` : ''}`
      : `/${encoded}`

    const host = forcePathStyle ? base.host : `${bucket}.${base.host}`

    return `${base.protocol}//${host}${path}${query ? `?${query}` : ''}`
  }

  const request = async (method, key, { body, headers = {}, query, payloadHash } = {}) => {
    const url = urlFor(key, query)
    const hash = payloadHash ?? (body === undefined ? EMPTY_PAYLOAD_HASH : hashPayload(body))

    const signed = signRequest({ method, url, headers, payloadHash: hash, ...credentials })
    const response = await fetch(url, { method, headers: signed.headers, body })

    if (!response.ok) {
      throw await storageError(response, method, key)
    }

    return response
  }

  return {
    driver: 's3',
    bucket,
    endpoint,

    /**
     * Upload an object.
     *
     * @param {string} key
     * @param {string|Buffer|Uint8Array} body
     * @param {Object} [options]
     * @returns {Promise<{ key: string, etag: string, size: number }>}
     */
    async put(key, body, options = {}) {
      const headers = { 'content-type': options.contentType || 'application/octet-stream' }

      if (options.cacheControl) headers['cache-control'] = options.cacheControl
      if (options.contentDisposition) headers['content-disposition'] = options.contentDisposition

      // Custom metadata rides along as x-amz-meta-* and is signed with the rest.
      for (const [name, value] of Object.entries(options.metadata || {})) {
        headers[`x-amz-meta-${name.toLowerCase()}`] = String(value)
      }

      const response = await request('PUT', key, { body, headers })

      return {
        key,
        etag: (response.headers.get('etag') || '').replace(/"/g, ''),
        size: body ? Buffer.byteLength(body) : 0
      }
    },

    /**
     * Download an object.
     *
     * @param {string} key
     * @returns {Promise<{ body: Buffer, contentType: string, size: number, etag: string }>}
     */
    async get(key) {
      const response = await request('GET', key)
      const body = Buffer.from(await response.arrayBuffer())

      return {
        body,
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        size: body.length,
        etag: (response.headers.get('etag') || '').replace(/"/g, '')
      }
    },

    /**
     * Object metadata, without transferring the body.
     *
     * @param {string} key
     * @returns {Promise<{ size: number, contentType: string, etag: string, lastModified: string }|null>}
     */
    async head(key) {
      try {
        const response = await request('HEAD', key)

        return {
          size: Number(response.headers.get('content-length') || 0),
          contentType: response.headers.get('content-type') || 'application/octet-stream',
          etag: (response.headers.get('etag') || '').replace(/"/g, ''),
          lastModified: response.headers.get('last-modified') || null
        }
      } catch (error) {
        if (error.status === 404) return null
        throw error
      }
    },

    /**
     * Whether an object exists.
     *
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async exists(key) {
      return (await this.head(key)) !== null
    },

    /**
     * Remove an object.
     *
     * @param {string} key
     * @returns {Promise<void>}
     */
    async delete(key) {
      try {
        await request('DELETE', key)
      } catch (error) {
        // Deleting something already gone is the state the caller wanted.
        if (error.status !== 404) throw error
      }
    },

    /**
     * List objects under a prefix.
     *
     * @param {Object} [options]
     * @returns {Promise<{ items: Array, cursor: string|null }>}
     */
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      const query = new URLSearchParams({ 'list-type': '2', 'max-keys': String(limit) })
      if (prefix) query.set('prefix', prefix)
      if (cursor) query.set('continuation-token', cursor)

      const response = await request('GET', '', { query: query.toString() })
      const xml = await response.text()

      return {
        items: parseListResult(xml),
        cursor: extractTag(xml, 'NextContinuationToken')
      }
    },

    /**
     * A URL the holder can use without credentials.
     *
     * @param {string} key
     * @param {Object} [options]
     * @param {string} [options.method]
     * @param {number} [options.expiresIn] - seconds
     * @param {string} [options.contentType] - required of the uploader when set
     * @returns {string}
     */
    signedUrl(key, { method = 'GET', expiresIn = 900, contentType, headers = {} } = {}) {
      const signedHeaders = { ...headers }

      // Binding the content type means the browser cannot upload a script under
      // a URL that was issued for an image.
      if (contentType) signedHeaders['content-type'] = contentType

      return presignUrl({
        method,
        url: urlFor(key),
        expiresIn,
        headers: signedHeaders,
        payloadHash: UNSIGNED_PAYLOAD,
        ...credentials
      })
    },

    /**
     * The public URL for a key.
     *
     * Only meaningful when the bucket or its CDN is world-readable; for a
     * private bucket use `signedUrl`.
     *
     * @param {string} key
     * @returns {string}
     */
    publicUrl(key) {
      if (config.publicUrl) {
        return `${String(config.publicUrl).replace(/\/$/, '')}/${encodeKey(key)}`
      }

      return urlFor(key)
    }
  }
}

/** Trim a trailing slash and supply a scheme if one was omitted. */
function normalizeEndpoint(endpoint) {
  if (!endpoint) return null

  const withScheme = /^https?:\/\//.test(endpoint) ? endpoint : `https://${endpoint}`
  return withScheme.replace(/\/+$/, '')
}

/**
 * Guess the addressing style.
 *
 * AWS and R2 serve virtual-host style; a self-hosted endpoint on an IP or
 * localhost cannot, because there is no wildcard DNS in front of it.
 */
function inferPathStyle(endpoint) {
  const { hostname } = new URL(endpoint)

  if (hostname === 'localhost' || hostname === '127.0.0.1') return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return true
  if (hostname.endsWith('.amazonaws.com')) return false
  if (hostname.endsWith('.r2.cloudflarestorage.com')) return false

  // Anything else is likely self-hosted, where path style always works.
  return true
}

/**
 * Encode an object key for a URL.
 *
 * Slashes stay as slashes so the key keeps its folder structure; everything
 * else is encoded. The signer encodes the same way, so the two agree.
 */
function encodeKey(key) {
  return String(key)
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')
}

/** Turn a failed response into an Error carrying the status and S3's code. */
async function storageError(response, method, key) {
  let detail = ''

  try {
    const text = await response.text()
    const code = extractTag(text, 'Code')
    const message = extractTag(text, 'Message')
    detail = code ? ` (${code}${message ? `: ${message}` : ''})` : ''
  } catch {
    // A body that cannot be read is not worth failing over.
  }

  const error = new Error(`S3 ${method} ${key || '/'} failed with ${response.status}${detail}`)
  error.status = response.status
  error.key = key

  return error
}

/** Pull the objects out of a ListObjectsV2 response. */
function parseListResult(xml) {
  const items = []

  for (const [, block] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = extractTag(block, 'Key')
    if (!key) continue

    items.push({
      key: decodeXmlEntities(key),
      size: Number(extractTag(block, 'Size') || 0),
      etag: (extractTag(block, 'ETag') || '').replace(/&quot;|"/g, ''),
      lastModified: extractTag(block, 'LastModified')
    })
  }

  return items
}

function extractTag(xml, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? match[1] : null
}

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
