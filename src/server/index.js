/**
 * BasicBen Server
 *
 * Zero-dependency HTTP server with custom router, middleware, and auto-loading.
 * Includes hook system and plugin support for extensibility.
 */

import { createApp } from './http.js'
import { Router, createRouter } from './router.js'
import { bodyParser, json } from './body-parser.js'
import { cors } from './cors.js'
import { serveStatic, spaFallback } from './static.js'
import { loadRoutes, loadMiddleware, loadConfig } from './loader.js'
import { hooks, HOOKS } from '../hooks/index.js'
import { plugins } from '../plugins/index.js'
import { loadPlugins } from '../plugins/loader.js'

/**
 * Create a BasicBen server instance with hooks and plugin support
 */
export async function createServer(options = {}) {
  const config = await loadConfig()
  const mergedConfig = { ...defaultConfig, ...config, ...options }

  // Fire server.starting hook
  await hooks.fire(HOOKS.SERVER_STARTING, { config: mergedConfig })

  const staticConfig = mergedConfig.static === true ? {} : (mergedConfig.static || {})
  const notFoundHandler = mergedConfig.onNoMatch || defaultNotFoundHandler

  // The SPA fallback has to sit in onNoMatch rather than the middleware chain:
  // static middleware runs before routes are matched, so a fallback there would
  // answer API requests with the app shell.
  const onNoMatch = mergedConfig.static && staticConfig.spa
    ? spaFallback(staticConfig, notFoundHandler)
    : notFoundHandler

  const app = createApp({
    onError: mergedConfig.onError || defaultErrorHandler,
    onNoMatch
  })

  // Core middleware
  app.use(addResponseHelpers)

  // Request hooks middleware
  app.use(requestHooksMiddleware)

  if (mergedConfig.cors) {
    app.use(cors(mergedConfig.cors === true ? {} : mergedConfig.cors))
  }

  if (mergedConfig.bodyParser !== false) {
    app.use(bodyParser(mergedConfig.bodyParser || {}))
  }

  if (mergedConfig.static) {
    app.use(serveStatic(mergedConfig.static === true ? {} : mergedConfig.static))
  }

  // Load user middleware
  if (mergedConfig.autoloadMiddleware !== false) {
    const userMiddleware = await loadMiddleware(mergedConfig.middlewareDir)
    for (const mw of userMiddleware) {
      app.use(mw)
    }
  }

  // Create main router
  const router = createRouter()
  app.router = router

  // Load routes
  if (mergedConfig.autoloadRoutes !== false) {
    const loadedRouter = await loadRoutes(mergedConfig.routesDir)
    loadedRouter.applyTo(app)
  }

  // Load and register plugins
  if (mergedConfig.plugins !== false) {
    const pluginDir = mergedConfig.pluginsDir || 'plugins'
    const enabledPlugins = mergedConfig.enabledPlugins || []

    // Set plugin context
    plugins.setContext({
      router,
      app,
      config: mergedConfig,
      hooks
    })

    // Load plugins from directory
    const pluginResult = await loadPlugins(pluginDir, {
      enabled: enabledPlugins,
      context: {
        router,
        app,
        config: mergedConfig,
        hooks
      }
    })

    if (pluginResult.loaded.length > 0) {
      console.log(`Loaded plugins: ${pluginResult.loaded.join(', ')}`)
    }

    if (pluginResult.activated.length > 0) {
      console.log(`Activated plugins: ${pluginResult.activated.join(', ')}`)
    }

    if (pluginResult.errors.length > 0) {
      for (const error of pluginResult.errors) {
        console.error(`Plugin error (${error.name}): ${error.error}`)
      }
    }
  }

  // Apply plugin routes
  router.applyTo(app)

  /**
   * Start the server
   */
  app.start = async (port, callback) => {
    const listenPort = port || mergedConfig.port || 3001

    return new Promise((resolve, reject) => {
      app.listen(listenPort, async (err) => {
        if (err) {
          reject(err)
          return
        }

        // Fire server.started hook
        await hooks.fire(HOOKS.SERVER_STARTED, {
          port: listenPort,
          config: mergedConfig
        })

        if (callback) callback()
        resolve(app)
      })
    })
  }

  /**
   * Stop the server gracefully
   */
  app.stop = async () => {
    await hooks.fire(HOOKS.SERVER_STOPPING, {})
    await plugins.deactivateAll()

    if (app.server) {
      return new Promise((resolve) => {
        app.server.close(() => resolve())
      })
    }
  }

  // Expose hooks and plugins on app
  app.hooks = hooks
  app.plugins = plugins

  return app
}

/**
 * Request hooks middleware - fires request.before and request.after hooks
 */
async function requestHooksMiddleware(req, res, next) {
  // Store original end method
  const originalEnd = res.end.bind(res)
  let responseData = null

  // Fire request.before hook
  try {
    const context = await hooks.filter(HOOKS.REQUEST_BEFORE, { req, res })
    // Allow hooks to modify req/res or short-circuit
    if (context.handled) {
      return
    }
  } catch (err) {
    console.error('Error in request.before hook:', err.message)
  }

  // Override res.end to capture response and fire request.after
  res.end = async function(data, encoding) {
    responseData = data

    // Fire request.after hook
    try {
      await hooks.fire(HOOKS.REQUEST_AFTER, {
        req,
        res,
        responseData,
        statusCode: res.statusCode
      })
    } catch (err) {
      console.error('Error in request.after hook:', err.message)
    }

    // Call original end
    originalEnd(data, encoding)
  }

  next()
}

/**
 * Default configuration
 */
const defaultConfig = {
  port: 3001,
  cors: true,
  bodyParser: { limit: '1mb' },
  static: { dir: 'public' },
  routesDir: 'src/routes',
  middlewareDir: 'src/middleware',
  pluginsDir: 'plugins',
  autoloadRoutes: true,
  autoloadMiddleware: true,
  plugins: true,
  enabledPlugins: []
}

/**
 * Default error handler
 */
function defaultErrorHandler(err, req, res) {
  console.error('Server error:', err)

  // Fire request.error hook
  hooks.fire(HOOKS.REQUEST_ERROR, { err, req, res }).catch(console.error)

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
  res.statusCode = 404
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: 'Not Found' }))
}

/**
 * Response helpers - added to res object
 */
export function addResponseHelpers(req, res, next) {
  /**
   * Send JSON response
   */
  res.json = (data, statusCode = 200) => {
    res.statusCode = statusCode
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
  }

  /**
   * Send response with status code
   */
  res.status = (code) => {
    res.statusCode = code
    return res
  }

  /**
   * Send text response
   */
  res.send = (data) => {
    if (typeof data === 'object') {
      return res.json(data)
    }
    res.end(String(data))
  }

  /**
   * Redirect to URL
   */
  res.redirect = (url, statusCode = 302) => {
    res.statusCode = statusCode
    res.setHeader('Location', url)
    res.end()
  }

  next()
}

// Re-export components
export { createApp } from './http.js'
export { Router, createRouter } from './router.js'
export { bodyParser, json } from './body-parser.js'
export { cors } from './cors.js'
export { serveStatic } from './static.js'
export { loadRoutes, loadMiddleware, loadConfig } from './loader.js'
export { hooks, HOOKS } from '../hooks/index.js'
export { plugins } from '../plugins/index.js'
export { loadPlugins } from '../plugins/loader.js'
export { themes } from '../themes/index.js'
export { loadThemes } from '../themes/loader.js'
export { updates } from '../updates/index.js'
export {
  getEnvironment,
  isCloud,
  isSelfHosted,
  getVersion,
  canManualUpdate
} from './environment.js'
