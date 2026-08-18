/**
 * Storage adapter loader.
 *
 * Mirrors `src/db/index.js`: a memoized instance and a driver switch.
 *
 * ## One driver for R2 and S3
 *
 * R2 speaks the S3 API, and so do MinIO, Backblaze B2 and DigitalOcean Spaces.
 * The difference between them is an endpoint and a region, so there is one
 * `s3` driver and no branching in application code. Moving from R2 to S3 is two
 * lines of config.
 *
 * ## The adapter contract
 *
 * - put(key, body, options)   → { key, etag, size }
 * - get(key)                  → { body, contentType, size, etag }
 * - head(key)                 → metadata, or null when absent
 * - exists(key)               → boolean
 * - delete(key)               → void, and succeeds when already absent
 * - list({ prefix, limit, cursor }) → { items, cursor }
 * - signedUrl(key, options)   → a URL usable without credentials
 * - publicUrl(key)            → the world-readable URL
 */

import { loadConfig } from '../server/loader.js'

let storageInstance = null

/**
 * Get or create the storage adapter.
 *
 * @returns {Promise<Object>}
 */
export async function getStorage() {
  if (storageInstance) return storageInstance

  const config = await loadConfig()
  const storageConfig = resolveConfig(config.storage || {})

  switch (storageConfig.driver) {
    case 's3':
    case 'r2':
    case 'minio':
    case 'spaces':
    case 'b2': {
      // Every one of these is the S3 API behind a different endpoint. Accepting
      // the names as aliases means config reads the way the operator thinks,
      // without a second implementation to keep in step.
      const { createS3Adapter } = await import('./adapters/s3.js')
      storageInstance = createS3Adapter(storageConfig)
      break
    }

    case 'local': {
      const { createLocalAdapter } = await import('./adapters/local.js')
      storageInstance = createLocalAdapter(storageConfig)
      break
    }

    default:
      throw new Error(
        `Unknown storage driver: ${storageConfig.driver}\n` +
        'Supported drivers: s3 (also r2, minio, spaces, b2), local'
      )
  }

  return storageInstance
}

/**
 * Fill in configuration from the environment.
 *
 * The driver defaults to `local` when no bucket is configured, so a fresh
 * project works before anyone has a cloud account.
 *
 * @param {Object} config
 * @returns {Object}
 */
export function resolveConfig(config = {}) {
  const bucket = config.bucket || process.env.S3_BUCKET
  const accessKeyId = config.accessKeyId || process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = config.secretAccessKey || process.env.S3_SECRET_ACCESS_KEY

  const driver = config.driver || (bucket && accessKeyId ? 's3' : 'local')

  return {
    ...config,
    driver,
    bucket,
    accessKeyId,
    secretAccessKey,
    sessionToken: config.sessionToken || process.env.S3_SESSION_TOKEN,
    endpoint: config.endpoint || process.env.S3_ENDPOINT,
    region: config.region || process.env.S3_REGION || 'auto',
    publicUrl: config.publicUrl || process.env.S3_PUBLIC_URL,
    maxSize: config.maxSize ?? 10 * 1024 * 1024
  }
}

/**
 * Reset the memoized adapter. For tests, and for a config reload.
 */
export function resetStorage() {
  storageInstance = null
}

/**
 * Build an adapter directly, bypassing config.
 *
 * @param {Object} config
 * @returns {Promise<Object>}
 */
export async function createStorage(config = {}) {
  const resolved = resolveConfig(config)

  if (resolved.driver === 'local') {
    const { createLocalAdapter } = await import('./adapters/local.js')
    return createLocalAdapter(resolved)
  }

  const { createS3Adapter } = await import('./adapters/s3.js')
  return createS3Adapter(resolved)
}

/**
 * Build a storage key for an upload.
 *
 * Keys are date-partitioned and carry random bytes, which does three things:
 * two files called `screenshot.png` do not collide, a caller cannot overwrite
 * someone else's object by guessing a key, and no directory ends up with a
 * hundred thousand entries.
 *
 * @param {string} filename
 * @param {Object} [options]
 * @param {string} [options.prefix]
 * @param {Date} [options.now]
 * @returns {string}
 */
export function buildKey(filename, options = {}) {
  const now = options.now || new Date()
  const prefix = (options.prefix || 'media').replace(/^\/+|\/+$/g, '')

  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')

  const random = Math.random().toString(36).slice(2, 10)
  const safe = sanitizeFilename(filename)

  return `${prefix}/${year}/${month}/${random}-${safe}`
}

/**
 * Reduce a user-supplied filename to something safe to put in a key.
 *
 * Path separators and traversal sequences are removed rather than escaped:
 * there is no legitimate reason for either in a filename, and keeping them
 * would let an upload choose where it lands.
 *
 * @param {string} filename
 * @returns {string}
 */
export function sanitizeFilename(filename) {
  const base = String(filename || 'file')
    .split(/[/\\]/).pop()
    .replace(/\0/g, '')
    .toLowerCase()

  const cleaned = base
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+/, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 100)

  return cleaned || 'file'
}

/**
 * Resolve a storage URL into one a consumer somewhere else can fetch.
 *
 * The local driver serves from the app's own origin, so `publicUrl()` hands
 * back `/uploads/...`. That is right for the bundled frontend and useless to a
 * headless consumer: a static build running on another host has nothing to
 * resolve it against, and the markup it emits would point at its own server.
 * The S3 driver already returns an absolute URL, and an absolute URL passes
 * through untouched.
 *
 * The input comes back unchanged when there is no base to resolve against, or
 * when the base is unusable. A relative URL is worse than an absolute one and
 * far better than throwing from inside a read endpoint.
 *
 * @param {string} url - a URL from `publicUrl()`, absolute or app-relative
 * @param {string} [base] - origin to resolve against; defaults to APP_URL
 * @returns {string}
 */
export function absoluteUrl(url, base = process.env.APP_URL) {
  if (!url || !base) return url

  try {
    return new URL(url, base).href
  } catch {
    // An unparseable APP_URL is the operator's problem to fix, not a reason for
    // every media read to 500.
    return url
  }
}

export { createS3Adapter } from './adapters/s3.js'
export { createLocalAdapter } from './adapters/local.js'
export {
  signRequest,
  presignUrl,
  hashPayload,
  amzDate,
  UNSIGNED_PAYLOAD,
  EMPTY_PAYLOAD_HASH
} from './sigv4.js'
