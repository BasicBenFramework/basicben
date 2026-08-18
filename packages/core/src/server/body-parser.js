/**
 * Body parser middleware.
 * Parses JSON and URL-encoded bodies.
 *
 * No dependencies - uses native Node.js APIs.
 */

/**
 * Build a predicate for routes the parser must not touch.
 *
 * Accepts a function, a path prefix, or a list of prefixes. `req.path` is set
 * before middleware runs, so a prefix is enough to identify a route even though
 * routing itself has not happened yet.
 *
 * @param {Function|string|string[]|undefined} skip
 * @returns {(req: Object) => boolean}
 */
function skipPredicate(skip) {
  if (!skip) return () => false
  if (typeof skip === 'function') return skip

  const prefixes = Array.isArray(skip) ? skip : [skip]

  return (req) => prefixes.some((prefix) => (req.path || req.url || '').startsWith(prefix))
}

/**
 * Parse request body based on content-type.
 *
 * `skip` leaves the request stream untouched, which is the only way to serve a
 * route that needs the bytes exactly as sent. Webhook signature verification is
 * the usual case: the signature is computed over the raw body, and a body that
 * has been parsed and re-stringified does not reproduce it — key order, spacing
 * and number formatting are all free to change.
 *
 * @param {Object} [options]
 * @param {string|number} [options.limit] - maximum body size
 * @param {Function|string|string[]} [options.skip] - routes to leave unparsed
 *
 * @example
 * // A webhook route reads the stream itself.
 * app.use(bodyParser({ skip: '/api/webhooks/' }))
 *
 * @example
 * app.use(bodyParser({ skip: (req) => req.headers['content-type'] === 'application/octet-stream' }))
 */
export function bodyParser(options = {}) {
  const limit = options.limit || '1mb'
  const maxBytes = parseSize(limit)
  const shouldSkip = skipPredicate(options.skip)

  return async (req, res, next) => {
    // Skip if no body expected
    if (req.method === 'GET' || req.method === 'HEAD') {
      return next()
    }

    // Opted out: the stream is left unread so the route can consume it.
    if (shouldSkip(req)) {
      return next()
    }

    const contentType = req.headers['content-type'] || ''

    try {
      const raw = await readBody(req, maxBytes)

      if (contentType.includes('application/json')) {
        req.body = raw ? JSON.parse(raw) : {}
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        req.body = parseUrlEncoded(raw)
      } else {
        req.body = raw
      }

      next()
    } catch (err) {
      if (err.code === 'BODY_TOO_LARGE') {
        res.statusCode = 413
        res.end(JSON.stringify({ error: 'Payload too large' }))
        return
      }

      if (err instanceof SyntaxError) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
        return
      }

      next(err)
    }
  }
}

/**
 * Read raw body from request stream
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0

    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        const err = new Error('Body too large')
        err.code = 'BODY_TOO_LARGE'
        reject(err)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })

    req.on('error', reject)
  })
}

/**
 * Parse URL-encoded body
 */
function parseUrlEncoded(str) {
  if (!str) return {}

  const params = new URLSearchParams(str)
  const result = {}

  for (const [key, value] of params) {
    // Handle array notation: items[]=a&items[]=b
    if (key.endsWith('[]')) {
      const arrayKey = key.slice(0, -2)
      if (!result[arrayKey]) result[arrayKey] = []
      result[arrayKey].push(value)
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * Parse size string to bytes
 */
function parseSize(str) {
  if (typeof str === 'number') return str

  const units = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024
  }

  const match = str.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/)
  if (!match) return 1024 * 1024 // default 1mb

  const num = parseFloat(match[1])
  const unit = match[2] || 'b'

  return Math.floor(num * units[unit])
}

/**
 * JSON-only body parser.
 *
 * Takes the same `skip` option as `bodyParser`, for the same reason.
 *
 * @param {Object} [options]
 * @param {string|number} [options.limit] - maximum body size
 * @param {Function|string|string[]} [options.skip] - routes to leave unparsed
 */
export function json(options = {}) {
  const limit = options.limit || '1mb'
  const maxBytes = parseSize(limit)
  const shouldSkip = skipPredicate(options.skip)

  return async (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return next()
    }

    if (shouldSkip(req)) {
      return next()
    }

    const contentType = req.headers['content-type'] || ''
    if (!contentType.includes('application/json')) {
      req.body = {}
      return next()
    }

    try {
      const raw = await readBody(req, maxBytes)
      req.body = raw ? JSON.parse(raw) : {}
      next()
    } catch (err) {
      if (err.code === 'BODY_TOO_LARGE') {
        res.statusCode = 413
        res.end(JSON.stringify({ error: 'Payload too large' }))
        return
      }

      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Invalid JSON' }))
    }
  }
}
