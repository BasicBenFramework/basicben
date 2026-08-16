/**
 * Filesystem storage.
 *
 * The development driver. It implements the same interface as the S3 adapter so
 * a project runs with no cloud credentials until it deploys, and switching is a
 * config change rather than a code change.
 *
 * `signedUrl` returns a URL carrying an HMAC of the key, method and expiry.
 * That is not decoration: without it the local path would accept any upload to
 * any key, and the two drivers would differ in whether an upload URL means
 * anything — which is exactly the sort of difference that is discovered in
 * production.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, writeFile, readFile, unlink, stat, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'

/**
 * @param {Object} config
 * @param {string} [config.dir] - where files are written
 * @param {string} [config.baseUrl] - URL prefix the files are served under
 * @param {string} [config.secret] - HMAC key for signed URLs
 * @returns {Object} storage adapter
 */
export function createLocalAdapter(config = {}) {
  const root = resolve(process.cwd(), config.dir || 'public/uploads')
  const baseUrl = (config.baseUrl || '/uploads').replace(/\/$/, '')
  const secret = config.secret || process.env.APP_KEY || 'basicben-local-storage'

  /**
   * Resolve a key to a path inside the storage root.
   *
   * A key arriving from a request can contain `..`, and joining it blindly
   * writes wherever the attacker likes. The resolved path is checked to be
   * inside the root, which is the only reliable way to enforce that.
   */
  const pathFor = (key) => {
    const cleaned = String(key).replace(/^\/+/, '')
    const full = resolve(root, cleaned)

    if (full !== root && !full.startsWith(root + sep)) {
      const error = new Error(`Refusing to access "${key}", which resolves outside the storage directory`)
      error.status = 400
      throw error
    }

    return full
  }

  const sign = (key, method, expires) =>
    createHmac('sha256', secret).update(`${method}\n${key}\n${expires}`).digest('hex')

  return {
    driver: 'local',
    root,

    async put(key, body, options = {}) {
      const path = pathFor(key)
      await mkdir(dirname(path), { recursive: true })

      const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '')
      await writeFile(path, buffer)

      // Content type is not stored — the filesystem has nowhere to put it — so
      // it is inferred from the extension on the way back out.
      return {
        key,
        etag: createHmac('sha256', secret).update(buffer).digest('hex').slice(0, 32),
        size: buffer.length
      }
    },

    async get(key) {
      const path = pathFor(key)

      if (!existsSync(path)) {
        const error = new Error(`No such object: ${key}`)
        error.status = 404
        throw error
      }

      const body = await readFile(path)

      return {
        body,
        contentType: contentTypeFor(key),
        size: body.length,
        etag: createHmac('sha256', secret).update(body).digest('hex').slice(0, 32)
      }
    },

    async head(key) {
      const path = pathFor(key)
      if (!existsSync(path)) return null

      const info = await stat(path)

      return {
        size: info.size,
        contentType: contentTypeFor(key),
        etag: `${info.size}-${info.mtimeMs}`,
        lastModified: info.mtime.toUTCString()
      }
    },

    async exists(key) {
      return existsSync(pathFor(key))
    },

    async delete(key) {
      const path = pathFor(key)
      if (!existsSync(path)) return

      await unlink(path)
    },

    async list({ prefix = '', limit = 1000 } = {}) {
      const items = []

      const walk = async (dir, relative) => {
        if (items.length >= limit) return
        if (!existsSync(dir)) return

        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (items.length >= limit) return

          const key = relative ? `${relative}/${entry.name}` : entry.name

          if (entry.isDirectory()) {
            await walk(join(dir, entry.name), key)
            continue
          }

          if (prefix && !key.startsWith(prefix)) continue

          const info = await stat(join(dir, entry.name))
          items.push({
            key,
            size: info.size,
            etag: `${info.size}-${info.mtimeMs}`,
            lastModified: info.mtime.toISOString()
          })
        }
      }

      await walk(root, '')

      // Sorted so paging is stable; the filesystem makes no such promise.
      items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

      return { items: items.slice(0, limit), cursor: null }
    },

    /**
     * A URL carrying an expiry and a signature over it.
     *
     * @param {string} key
     * @param {Object} [options]
     * @returns {string}
     */
    signedUrl(key, { method = 'GET', expiresIn = 900 } = {}) {
      const expires = Math.floor(Date.now() / 1000) + expiresIn
      const signature = sign(key, method.toUpperCase(), expires)
      const encoded = String(key).split('/').map(encodeURIComponent).join('/')

      return `${baseUrl}/${encoded}?expires=${expires}&signature=${signature}`
    },

    /**
     * Check a signature produced by `signedUrl`.
     *
     * @param {string} key
     * @param {Object} params
     * @returns {{ valid: boolean, reason?: string }}
     */
    verifySignedUrl(key, { method = 'GET', expires, signature } = {}) {
      if (!expires || !signature) return { valid: false, reason: 'missing' }
      if (Number(expires) < Math.floor(Date.now() / 1000)) return { valid: false, reason: 'expired' }

      const expected = sign(key, String(method).toUpperCase(), String(expires))

      // Compared in constant time: a fast reject leaks how much of a guess was
      // correct, which is enough to recover a signature byte by byte.
      const a = Buffer.from(expected, 'hex')
      const b = Buffer.from(String(signature), 'hex')

      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { valid: false, reason: 'signature' }
      }

      return { valid: true }
    },

    publicUrl(key) {
      const encoded = String(key).split('/').map(encodeURIComponent).join('/')
      return `${baseUrl}/${encoded}`
    }
  }
}

const CONTENT_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
  json: 'application/json', xml: 'application/xml', csv: 'text/csv',
  zip: 'application/zip', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf'
}

function contentTypeFor(key) {
  const extension = String(key).split('.').pop()?.toLowerCase()
  return CONTENT_TYPES[extension] || 'application/octet-stream'
}
