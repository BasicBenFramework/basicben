/**
 * Minimal HTTP Server
 *
 * Zero-dependency HTTP server using Node's built-in http module.
 * Express/Polka-compatible middleware API.
 */

import { createServer as createHttpServer } from 'node:http'

/**
 * Create a minimal HTTP server instance
 */
export function createApp(options = {}) {
  const middleware = []
  const routes = new Map()  // method -> [{pattern, params, handlers}]
  const onError = options.onError || defaultErrorHandler
  const onNoMatch = options.onNoMatch || defaultNotFoundHandler

  // Initialize route maps for each method
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  for (const method of methods) {
    routes.set(method, [])
  }

  /**
   * Add global middleware
   */
  function use(...handlers) {
    for (const handler of handlers) {
      if (typeof handler === 'function') {
        middleware.push(handler)
      }
    }
    return app
  }

  /**
   * Register a route
   */
  function addRoute(method, path, ...handlers) {
    const { pattern, paramNames } = pathToPattern(path)
    routes.get(method.toUpperCase()).push({
      path,
      pattern,
      paramNames,
      handlers
    })
    return app
  }

  /**
   * Convert path with params to regex
   * /users/:id -> /^\/users\/([^/]+)$/
   */
  function pathToPattern(path) {
    const paramNames = []

    let pattern = path
      // Handle catch-all
      .replace(/\/\*$/, '/(?<_catchAll>.*)')
      // Handle :params
      .replace(/:(\w+)/g, (_, name) => {
        paramNames.push(name)
        return '([^/]+)'
      })
      // Escape slashes
      .replace(/\//g, '\\/')

    return {
      pattern: new RegExp(`^${pattern}$`),
      paramNames
    }
  }

  /**
   * Match a request to a route
   */
  function matchRoute(method, pathname) {
    const routeList = routes.get(method.toUpperCase()) || []

    for (const route of routeList) {
      const match = pathname.match(route.pattern)
      if (match) {
        // Extract params
        const params = {}
        route.paramNames.forEach((name, i) => {
          params[name] = match[i + 1]
        })
        // Handle catch-all
        if (match.groups?._catchAll !== undefined) {
          params._catchAll = match.groups._catchAll
        }
        return { route, params }
      }
    }

    return null
  }

  /**
   * Run middleware chain
   */
  async function runMiddleware(handlers, req, res) {
    let index = 0

    const next = async (err) => {
      if (err) {
        return onError(err, req, res)
      }

      if (index >= handlers.length) {
        return
      }

      const handler = handlers[index++]

      try {
        await handler(req, res, next)
      } catch (error) {
        onError(error, req, res)
      }
    }

    await next()
  }

  /**
   * Handle incoming request
   */
  async function handleRequest(req, res) {
    // Parse URL using WHATWG URL API
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    req.path = url.pathname || '/'
    req.query = Object.fromEntries(url.searchParams)
    req.params = {}

    // Find matching route
    const matched = matchRoute(req.method, req.path)

    if (matched) {
      req.params = matched.params

      // Combine global middleware + route handlers
      const handlers = [...middleware, ...matched.route.handlers]
      await runMiddleware(handlers, req, res)
    } else {
      // Run global middleware first, then 404
      await runMiddleware([...middleware, () => onNoMatch(req, res)], req, res)
    }
  }

  /**
   * Create the HTTP server
   */
  const server = createHttpServer((req, res) => {
    handleRequest(req, res).catch(err => onError(err, req, res))
  })

  /**
   * The app object
   */
  const app = {
    use,
    server,

    // HTTP method shortcuts
    get: (path, ...handlers) => addRoute('GET', path, ...handlers),
    post: (path, ...handlers) => addRoute('POST', path, ...handlers),
    put: (path, ...handlers) => addRoute('PUT', path, ...handlers),
    patch: (path, ...handlers) => addRoute('PATCH', path, ...handlers),
    delete: (path, ...handlers) => addRoute('DELETE', path, ...handlers),
    head: (path, ...handlers) => addRoute('HEAD', path, ...handlers),
    options: (path, ...handlers) => addRoute('OPTIONS', path, ...handlers),

    /**
     * Start listening
     */
    listen(port, callback) {
      server.listen(port, callback)
      return app
    },

    /**
     * Close the server
     */
    close(callback) {
      server.close(callback)
    }
  }

  return app
}

/**
 * Default error handler
 */
function defaultErrorHandler(err, req, res) {
  console.error('Server error:', err)

  if (res.headersSent) return

  const statusCode = err.statusCode || err.status || 500
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal Server Error'
    : err.message

  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: message }))
}

/**
 * Default 404 handler
 */
function defaultNotFoundHandler(req, res) {
  if (res.headersSent) return

  res.statusCode = 404
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: 'Not Found' }))
}
