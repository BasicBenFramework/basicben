/**
 * Receiver for presigned uploads on the local driver.
 *
 * The S3 driver hands the browser a URL that points at the bucket, and the
 * bucket does the receiving. The local driver has no bucket, so something has
 * to accept that PUT — this does.
 *
 * Without it the default driver would issue upload URLs that go nowhere, and
 * every project would work in development only after configuring cloud
 * credentials, which is the opposite of what the local driver is for.
 *
 * It runs **before** the body parser. The parser drains every non-GET request
 * into a utf8 string, which both consumes the stream and corrupts binary — the
 * precise reason the previous multipart upload could never have worked.
 */

import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

/**
 * Middleware accepting PUTs to signed local-storage URLs.
 *
 * @param {Object} [options]
 * @param {string} [options.dir] - where files are written
 * @param {string} [options.baseUrl] - the path prefix these URLs use
 * @param {string} [options.secret] - HMAC key, must match the adapter's
 * @param {number} [options.maxSize] - bytes
 * @param {Object} [options.adapter] - supplies signature verification
 * @returns {Function} middleware
 */
export function localUploadReceiver(options = {}) {
  const root = resolve(process.cwd(), options.dir || 'public/uploads')
  const prefix = (options.baseUrl || '/uploads').replace(/\/$/, '')
  const maxSize = options.maxSize ?? 10 * 1024 * 1024

  let adapter = options.adapter

  return async (req, res, next) => {
    if (req.method !== 'PUT') return next()

    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith(`${prefix}/`)) return next()

    if (!adapter) {
      const { createLocalAdapter } = await import('./adapters/local.js')
      adapter = createLocalAdapter({ dir: options.dir, baseUrl: options.baseUrl, secret: options.secret })
    }

    const key = decodeURIComponent(url.pathname.slice(prefix.length + 1))

    const verified = adapter.verifySignedUrl(key, {
      method: 'PUT',
      expires: url.searchParams.get('expires'),
      signature: url.searchParams.get('signature')
    })

    if (!verified.valid) {
      res.statusCode = 403
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ error: `Upload refused: ${verified.reason}` }))
    }

    // The signature covers the key, so it is already known to be one this
    // server issued — but resolving it again costs nothing and means a change
    // to the signing scheme cannot turn into an arbitrary write.
    const path = resolve(root, key)
    if (path !== root && !path.startsWith(root + sep)) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ error: 'Invalid key' }))
    }

    try {
      await mkdir(dirname(path), { recursive: true })

      const outcome = await receive(req, path, maxSize)

      if (outcome.tooLarge) {
        await unlink(path).catch(() => {})
        res.statusCode = 413
        res.setHeader('Content-Type', 'application/json')
        return res.end(JSON.stringify({ error: 'File too large' }))
      }

      res.statusCode = 200
      res.setHeader('ETag', `"${outcome.written}"`)
      return res.end()
    } catch (error) {
      await unlink(path).catch(() => {})

      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ error: `Upload failed: ${error.message}` }))
    }
  }
}

/**
 * Stream the request body to disk, stopping if it exceeds the limit.
 *
 * The size is counted as it arrives rather than checked afterwards, because
 * buffering the whole body first is how an upload endpoint becomes a way to
 * exhaust memory.
 *
 * Once over the limit the remainder is read and discarded instead of the socket
 * being destroyed. Destroying it mid-body means the client sees a connection
 * error rather than the 413 explaining what happened — and an upload that fails
 * without saying why is one the user will simply retry. The connection is only
 * torn down if the sender keeps going well past the limit, which is the point
 * at which it is no longer a mistake.
 */
function receive(req, path, maxSize) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(path)
    const hardStop = Math.max(maxSize * 4, maxSize + 1024 * 1024)

    let written = 0
    let tooLarge = false
    let settled = false

    // Resolving before the stream has closed lets the caller's unlink() race
    // the stream's own pending filesystem work, which can recreate the file
    // immediately after it is deleted — leaving a partial upload on disk that
    // the 413 says was rejected.
    const closed = new Promise((done) => {
      file.on('close', done)
      file.on('error', done)
    })

    const finish = (value) => {
      if (settled) return
      settled = true

      closed.then(() => resolve(value))
    }

    file.on('error', (error) => {
      // Once the body is over the limit the file is being thrown away, so an
      // error from destroying it mid-write is the expected outcome rather than
      // a fault. Rejecting here raced the 'end' handler and turned an oversized
      // upload into a 500 instead of a 413, intermittently.
      if (tooLarge) return finish({ tooLarge: true, written })

      if (!settled) { settled = true; reject(error) }
    })

    req.on('data', (chunk) => {
      written += chunk.length

      if (written > maxSize) {
        if (!tooLarge) {
          tooLarge = true
          file.destroy()
        }

        // Far past the limit is no longer an accident; stop reading.
        if (written > hardStop) {
          req.destroy()
          finish({ tooLarge: true, written })
        }
        return
      }

      file.write(chunk)
    })

    req.on('end', () => {
      if (tooLarge) return finish({ tooLarge: true, written })
      file.end(() => finish({ tooLarge: false, written }))
    })

    req.on('error', (error) => {
      file.destroy()
      if (tooLarge) return finish({ tooLarge: true, written })
      if (!settled) { settled = true; reject(error) }
    })
  })
}
