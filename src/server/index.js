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

  // Presigned uploads on the local driver land here, and this has to run
  // *before* the body parser: the parser drains every non-GET request into a
  // utf8 string, which both consumes the stream and corrupts binary. That is
  // the reason the previous multipart upload path could never have worked.
  const storageConfig = mergedConfig.storage || {}
  if (storageConfig.driver !== false && !storageConfig.bucket && !process.env.S3_BUCKET) {
    const { localUploadReceiver } = await import('../storage/local-upload.js')
    app.use(localUploadReceiver({
      dir: storageConfig.dir,
      baseUrl: storageConfig.baseUrl,
      secret: storageConfig.secret,
      maxSize: storageConfig.maxSize
    }))
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

    // Which plugins are enabled comes from the database, because that is what
    // the admin UI writes to. Reading only `enabledPlugins` from config — which
    // defaults to [] and which the templates never set — meant every plugin was
    // loaded and registered but none was ever activated, so hooks never bound
    // and `initialize` never ran. Config still wins when it is set, so a
    // deployment can pin the list without a database.
    const enabledPlugins = mergedConfig.enabledPlugins?.length
      ? mergedConfig.enabledPlugins
      : await readEnabledPlugins(mergedConfig)

    const pluginContext = {
      router,
      app,
      config: mergedConfig,
      hooks
    }

    plugins.setContext(pluginContext)

    // Load plugins from directory
    const pluginResult = await loadPlugins(pluginDir, {
      enabled: enabledPlugins,
      context: pluginContext
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

  // `server.started` used to fire only from app.start(), and nothing calls
  // app.start() — both the TypeScript template's entry and the generated
  // production entry call app.listen() directly. So the hook never fired in any
  // real app, including for the example plugin that listens for it.
  //
  // Wrapping listen() means it fires however the server is started, including
  // from a hand-written entry. The flag stops it firing twice when app.start()
  // is used, since that calls listen() underneath.
  const nativeListen = app.listen.bind(app)
  let announced = false

  const announceStarted = async (port) => {
    if (announced) return
    announced = true

    await hooks.fire(HOOKS.SERVER_STARTED, { port, config: mergedConfig })
  }

  app.listen = (port, callback) => {
    return nativeListen(port, async (err) => {
      if (!err) await announceStarted(port)
      if (callback) callback(err)
    })
  }

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
/**
 * Read a setting the admin UI writes, without requiring a database.
 *
 * An app with no database, or one whose migrations have not run yet, must still
 * boot. Every failure here is expected rather than exceptional, so the caller
 * gets a default and the server starts.
 *
 * @param {string} key
 * @param {Object} config
 * @returns {Promise<string|null>}
 */
async function readSetting(key, config) {
  if (config.db === false) return null

  try {
    const { getDb } = await import('../db/index.js')
    const db = await getDb()
    const row = await db.get('SELECT value FROM settings WHERE key = ?', [key])

    return row?.value ?? null
  } catch {
    return null
  }
}

/** The plugins the admin UI has enabled. */
async function readEnabledPlugins(config) {
  const value = await readSetting('enabled_plugins', config)
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

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
  // An explicit second argument wins; otherwise whatever res.status() already
  // set is kept. Defaulting to 200 here made `res.status(404).json(...)` — the
  // idiom everyone reaches for — silently answer 200.
  res.json = (data, statusCode) => {
    if (statusCode !== undefined) {
      res.statusCode = statusCode
    }
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
export { updates } from '../updates/index.js'
export {
  getEnvironment,
  isCloud,
  isSelfHosted,
  getVersion,
  canManualUpdate
} from './environment.js'
