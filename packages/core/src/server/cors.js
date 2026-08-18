/**
 * CORS middleware.
 * Handles Cross-Origin Resource Sharing headers.
 */

const defaults = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: [],
  credentials: false,
  maxAge: 86400 // 24 hours
}

export function cors(options = {}) {
  const config = { ...defaults, ...options }

  // Browsers reject `Access-Control-Allow-Origin: *` together with
  // `Access-Control-Allow-Credentials: true`, so this combination silently
  // breaks every credentialed cross-origin request. Drop credentials rather
  // than reflecting the request origin — reflecting would turn a config
  // mistake into "any site may make credentialed calls to this API".
  if (config.origin === '*' && config.credentials) {
    console.warn(
      "[basicben] cors: origin '*' cannot be combined with credentials: true — " +
      'browsers reject that pairing. Ignoring credentials. Set an explicit ' +
      'origin (a string, array, or function) to allow credentialed requests.'
    )
    config.credentials = false
  }

  return (req, res, next) => {
    const origin = req.headers.origin

    // Whether this particular request's origin was allowed. An allowlist that
    // does not match sets no header at all, which is what makes the browser
    // refuse it.
    let allowedOrigin = false

    // Set origin header
    if (config.origin === '*') {
      res.setHeader('Access-Control-Allow-Origin', '*')
      allowedOrigin = true
    } else if (typeof config.origin === 'string') {
      res.setHeader('Access-Control-Allow-Origin', config.origin)
      res.setHeader('Vary', 'Origin')
      allowedOrigin = true
    } else if (Array.isArray(config.origin)) {
      if (origin && config.origin.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
        allowedOrigin = true
      }
    } else if (typeof config.origin === 'function') {
      const allowed = config.origin(origin, req)
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', typeof allowed === 'string' ? allowed : origin)
        res.setHeader('Vary', 'Origin')
        allowedOrigin = true
      }
    }

    // Credentials, but only alongside an origin that was actually allowed.
    // `Access-Control-Allow-Credentials: true` with no accompanying
    // `Access-Control-Allow-Origin` means nothing to a browser and reads, to
    // anyone debugging a refused request, as though the server said yes.
    if (config.credentials && allowedOrigin) {
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    // Exposed headers
    if (config.exposedHeaders.length > 0) {
      res.setHeader('Access-Control-Expose-Headers', config.exposedHeaders.join(', '))
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', config.methods.join(', '))
      res.setHeader('Access-Control-Allow-Headers', config.allowedHeaders.join(', '))
      res.setHeader('Access-Control-Max-Age', String(config.maxAge))

      res.statusCode = 204
      res.end()
      return
    }

    next()
  }
}
