/**
 * Custom Router
 *
 * Features:
 * - Route registration (GET, POST, PUT, PATCH, DELETE)
 * - Route groups with shared prefix/middleware
 * - Per-route middleware
 * - Named routes for URL generation
 * - Parameter parsing
 */

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

export class Router {
  constructor(options = {}) {
    this.prefix = options.prefix || ''
    this.middleware = options.middleware || []
    this.routes = []
    this.namedRoutes = new Map()
    this.groups = []
  }

  /**
   * Register a route
   */
  #addRoute(method, path, ...handlers) {
    const fullPath = this.#normalizePath(this.prefix + path)

    // Last handler is the main handler, rest are middleware
    const mainHandler = handlers.pop()

    // The route name is a string among the remaining arguments. Pull it out
    // wherever it appears rather than only at index 0: `resource()` emits the
    // name after any middleware, and leaving a string in the chain means it is
    // later invoked as a middleware function and throws "fn is not a function".
    let name = null
    const routeMiddleware = []
    for (const arg of handlers) {
      if (typeof arg === 'string') {
        if (name === null) name = arg
        continue
      }
      routeMiddleware.push(arg)
    }

    const route = {
      method: method.toUpperCase(),
      path: fullPath,
      pattern: this.#pathToPattern(fullPath),
      middleware: [...this.middleware, ...routeMiddleware],
      handler: mainHandler,
      name
    }

    this.routes.push(route)

    if (name) {
      this.namedRoutes.set(name, route)
    }

    return this
  }

  /**
   * Normalize path - ensure leading slash, no trailing slash
   */
  #normalizePath(path) {
    if (!path || path === '/') return '/'
    let normalized = path.startsWith('/') ? path : '/' + path
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  }

  /**
   * Convert path to regex pattern for matching
   */
  #pathToPattern(path) {
    // Convert :param to named capture groups
    // /users/:id -> /users/(?<id>[^/]+)
    // Also handle catch-all: /* -> /(.*)
    let pattern = path
      .replace(/\/\*$/, '/(?<_catchAll>.*)')  // Catch-all at end
      .replace(/\/:(\w+)/g, '/(?<$1>[^/]+)')
      .replace(/\//g, '\\/')

    return new RegExp(`^${pattern}$`)
  }

  /**
   * HTTP method shortcuts
   */
  get(path, ...handlers) {
    return this.#addRoute('get', path, ...handlers)
  }

  post(path, ...handlers) {
    return this.#addRoute('post', path, ...handlers)
  }

  put(path, ...handlers) {
    return this.#addRoute('put', path, ...handlers)
  }

  patch(path, ...handlers) {
    return this.#addRoute('patch', path, ...handlers)
  }

  delete(path, ...handlers) {
    return this.#addRoute('delete', path, ...handlers)
  }

  head(path, ...handlers) {
    return this.#addRoute('head', path, ...handlers)
  }

  options(path, ...handlers) {
    return this.#addRoute('options', path, ...handlers)
  }

  /**
   * Register route for all methods
   */
  all(path, ...handlers) {
    for (const method of METHODS) {
      this.#addRoute(method, path, ...handlers)
    }
    return this
  }

  /**
   * Create a route group with shared prefix and/or middleware
   *
   * Usage:
   *   router.group('/admin', adminAuth, (group) => {
   *     group.get('/users', listUsers)
   *     group.get('/users/:id', showUser)
   *   })
   */
  group(prefix, ...args) {
    const callback = args.pop()
    const groupMiddleware = args

    const group = new Router({
      prefix: this.prefix + prefix,
      middleware: [...this.middleware, ...groupMiddleware]
    })

    callback(group)

    // Merge group routes into this router
    this.routes.push(...group.routes)
    for (const [name, route] of group.namedRoutes) {
      this.namedRoutes.set(name, route)
    }

    return this
  }

  /**
   * Add middleware to all routes in this router
   */
  use(...middleware) {
    this.middleware.push(...middleware)
    return this
  }

  /**
   * Generate URL for a named route
   *
   * Usage:
   *   router.route('users.show', { id: 1 }) // => '/users/1'
   */
  route(name, params = {}) {
    const route = this.namedRoutes.get(name)
    if (!route) {
      throw new Error(`Route '${name}' not found`)
    }

    let path = route.path
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`:${key}`, String(value))
    }

    return path
  }

  /**
   * Match a request to a route
   */
  match(method, path) {
    const normalizedPath = this.#normalizePath(path)

    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue

      const match = normalizedPath.match(route.pattern)
      if (match) {
        return {
          route,
          params: match.groups || {}
        }
      }
    }

    return null
  }

  /**
   * Apply routes to an app instance
   */
  applyTo(app) {
    for (const route of this.routes) {
      const method = route.method.toLowerCase()
      const handlers = [...route.middleware, route.handler].map(wrapAsync)

      app[method](route.path, ...handlers)
    }

    return app
  }

  /**
   * Get all registered routes (for debugging/listing)
   */
  getRoutes() {
    return this.routes.map(r => ({
      method: r.method,
      path: r.path,
      name: r.name,
      middlewareCount: r.middleware.length
    }))
  }
}

/**
 * Resource routing helper - generates CRUD routes
 *
 * Usage:
 *   router.resource('/users', UserController)
 *
 * Generates:
 *   GET    /users          -> index
 *   GET    /users/:id      -> show
 *   POST   /users          -> create
 *   PUT    /users/:id      -> update
 *   DELETE /users/:id      -> destroy
 */
Router.prototype.resource = function(path, controller, options = {}) {
  const name = options.name || path.replace(/^\//, '').replace(/\//g, '.')
  const only = options.only || ['index', 'show', 'create', 'update', 'destroy']
  const middleware = options.middleware || []

  if (only.includes('index') && controller.index) {
    this.get(path, ...middleware, `${name}.index`, controller.index)
  }
  if (only.includes('show') && controller.show) {
    this.get(`${path}/:id`, ...middleware, `${name}.show`, controller.show)
  }
  if (only.includes('create') && controller.create) {
    this.post(path, ...middleware, `${name}.create`, controller.create)
  }
  if (only.includes('update') && controller.update) {
    this.put(`${path}/:id`, ...middleware, `${name}.update`, controller.update)
  }
  if (only.includes('destroy') && controller.destroy) {
    this.delete(`${path}/:id`, ...middleware, `${name}.destroy`, controller.destroy)
  }

  return this
}

/**
 * Create a new router instance
 */
export function createRouter(options) {
  return new Router(options)
}

/**
 * Wrap handler to catch async errors and pass to error handler
 */
function wrapAsync(fn) {
  return (req, res, next) => {
    const result = fn(req, res, next)
    if (result && typeof result.catch === 'function') {
      result.catch(next)
    }
  }
}
