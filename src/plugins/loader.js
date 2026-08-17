/**
 * Plugin Auto-Loader for BasicBen CMS
 *
 * Scans the plugins directory and loads all plugins automatically.
 * Each plugin can be a single file or a directory with an index.js.
 */

import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { plugins } from './index.js'

/**
 * Extensions a plugin file may use.
 *
 * TypeScript is here because Node strips types natively, so a `.ts` plugin
 * imports with no build step. That only covers *erasable* syntax — an `enum`,
 * a `namespace` or a constructor parameter property will fail to load, since
 * those emit runtime code that stripping cannot produce.
 *
 * `.tsx` is deliberately absent: Node does not transform JSX, and a plugin
 * that needs JSX needs a build step regardless of what it is called.
 */
const PLUGIN_EXTENSIONS = ['.js', '.mjs', '.ts', '.mts']

/**
 * Load plugins, from an explicit list and/or a directory.
 *
 * The two registration styles exist for different deployments. Scanning a
 * directory is convenient in development — drop a file in `plugins/` and
 * restart — but `readdirSync` plus a dynamic `import()` of a path computed at
 * runtime is invisible to a bundler, so the files are simply not there on a
 * host that ships a bundle rather than a working tree. Passing the plugin
 * objects in is a static import: it bundles, it type-checks, and it needs no
 * filesystem at all.
 *
 * Explicit plugins win. A name registered from the list is skipped during the
 * scan, so importing `plugins/hello-world.js` *and* leaving it on disk
 * registers it once rather than twice.
 *
 * A plugin's name lives inside its config, so the scan has to import a file
 * before it can tell whether that name is already taken. A plugin listed here
 * *and* present on disk is therefore evaluated twice — once as the bundled
 * copy, once from the filesystem — and only the first is registered. That
 * costs one module evaluation at boot and changes nothing else; matching on
 * filename instead would be wrong for any plugin whose name is not its
 * filename.
 *
 * @param {string|false} dir - Directory to scan, or false to scan nothing
 * @param {Object} [options] - Loading options
 * @param {string[]} [options.enabled] - Plugin names to auto-activate
 * @param {Object} [options.context] - Application context (db, router, etc.)
 * @param {Array<Object>} [options.modules] - Already-imported plugin configs
 * @returns {Promise<{loaded: string[], activated: string[], errors: Array<{name: string, error: string}>}>}
 *
 * @example
 * // Statically imported — works anywhere, including bundled deployments
 * import helloWorld from '../plugins/hello-world.js'
 *
 * await loadPlugins(false, {
 *   modules: [helloWorld],
 *   enabled: ['hello-world'],
 *   context: { db, router }
 * })
 *
 * @example
 * // Scanned from disk — convenient in development
 * await loadPlugins('plugins', { enabled: ['hello-world'], context: { db, router } })
 */
export async function loadPlugins(dir = 'plugins', options = {}) {
  const { enabled = [], context = {}, modules = [] } = options

  const result = {
    loaded: [],
    activated: [],
    errors: []
  }

  // Set context for plugins
  plugins.setContext(context)

  /** Register one config and activate it if enabled, recording either outcome. */
  const use = async (pluginConfig, label, source) => {
    plugins.register(pluginConfig, { source })
    result.loaded.push(pluginConfig.name)

    // A plugin that fails to activate is recorded and skipped rather than
    // taking the boot down with it — one broken plugin should not stop the
    // site serving.
    if (enabled.includes(pluginConfig.name)) {
      try {
        await plugins.activate(pluginConfig.name)
        result.activated.push(pluginConfig.name)
      } catch (err) {
        result.errors.push({ name: pluginConfig.name, error: err.message })
        console.error(`Plugin "${label}" was not activated:`, err.message)
      }
    }
  }

  for (const [index, mod] of modules.entries()) {
    // A namespace object from `import * as p` carries the config on `default`.
    const pluginConfig = mod?.default ?? mod
    const label = pluginConfig?.name || `plugins[${index}]`

    try {
      if (!pluginConfig || typeof pluginConfig !== 'object') {
        throw new Error(
          `Expected a plugin object, got ${pluginConfig === null ? 'null' : typeof pluginConfig}`
        )
      }

      await use(pluginConfig, label, 'config')
    } catch (err) {
      result.errors.push({ name: label, error: err.message })
      console.error(`Error loading plugin "${label}":`, err.message)
    }
  }

  if (dir === false) {
    return result
  }

  const pluginsDir = resolve(process.cwd(), dir)

  if (!existsSync(pluginsDir)) {
    return result
  }

  const registered = new Set(result.loaded)
  const entries = readdirSync(pluginsDir)

  for (const entry of entries) {
    // Skip hidden files and .gitkeep
    if (entry.startsWith('.')) {
      continue
    }

    const fullPath = join(pluginsDir, entry)
    const stat = statSync(fullPath)

    try {
      let pluginConfig

      if (stat.isDirectory()) {
        // Directory plugin - look for index.js or plugin.js
        pluginConfig = await loadDirectoryPlugin(fullPath)
      } else if (PLUGIN_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
        // Single file plugin
        pluginConfig = await loadFilePlugin(fullPath)
      }

      if (pluginConfig && !registered.has(pluginConfig.name)) {
        await use(pluginConfig, pluginConfig.name, 'directory')
      }
    } catch (err) {
      result.errors.push({
        name: entry,
        error: err.message
      })
      console.error(`Error loading plugin "${entry}":`, err.message)
    }
  }

  return result
}

/**
 * Load a plugin from a directory
 * Looks for index.js, plugin.js, or reads plugin.json for metadata
 *
 * @param {string} dir - Plugin directory path
 * @returns {Promise<Object|null>}
 */
async function loadDirectoryPlugin(dir) {
  const possibleEntries = [
    'index.js', 'index.mjs', 'index.ts', 'index.mts',
    'plugin.js', 'plugin.mjs', 'plugin.ts', 'plugin.mts'
  ]

  for (const entry of possibleEntries) {
    const entryPath = join(dir, entry)

    if (existsSync(entryPath)) {
      const fileUrl = pathToFileURL(entryPath).href
      const module = await import(fileUrl)
      return module.default || module
    }
  }

  // Check for plugin.json (metadata only, hooks defined elsewhere)
  const jsonPath = join(dir, 'plugin.json')
  if (existsSync(jsonPath)) {
    const content = readFileSync(jsonPath, 'utf-8')
    const config = JSON.parse(content)

    // Load hooks from hooks.js if exists
    const hooksPath = join(dir, 'hooks.js')
    if (existsSync(hooksPath)) {
      const fileUrl = pathToFileURL(hooksPath).href
      const hooksModule = await import(fileUrl)
      config.hooks = hooksModule.default || hooksModule
    }

    return config
  }

  return null
}

/**
 * Load a plugin from a single file
 *
 * @param {string} file - Plugin file path
 * @returns {Promise<Object>}
 */
async function loadFilePlugin(file) {
  const fileUrl = pathToFileURL(file).href
  const module = await import(fileUrl)
  return module.default || module
}

/**
 * Get list of available plugins from directory (without loading them)
 *
 * @param {string} dir - Directory to scan
 * @returns {Array<{name: string, path: string, type: 'file'|'directory'}>}
 */
export function scanPlugins(dir = 'plugins') {
  const pluginsDir = resolve(process.cwd(), dir)
  const result = []

  if (!existsSync(pluginsDir)) {
    return result
  }

  const entries = readdirSync(pluginsDir)

  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue
    }

    const fullPath = join(pluginsDir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      // Check if it's a valid plugin directory
      const hasIndex = existsSync(join(fullPath, 'plugin.json')) ||
        PLUGIN_EXTENSIONS.some((ext) =>
          existsSync(join(fullPath, `index${ext}`)) || existsSync(join(fullPath, `plugin${ext}`))
        )

      if (hasIndex) {
        result.push({
          name: entry,
          path: fullPath,
          type: 'directory'
        })
      }
    } else if (PLUGIN_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      result.push({
        name: entry.replace(/\.(m?[jt]s)$/, ''),
        path: fullPath,
        type: 'file'
      })
    }
  }

  return result
}

/**
 * Load enabled plugins from a config file or database
 *
 * @param {Object} db - Database instance
 * @param {string} dir - Plugins directory
 * @param {Object} context - Application context
 * @returns {Promise<Object>}
 */
export async function loadEnabledPlugins(db, dir = 'plugins', context = {}) {
  // Try to get enabled plugins from database
  let enabled = []

  try {
    const settings = await db.get(
      'SELECT value FROM settings WHERE key = ?',
      ['enabled_plugins']
    )

    if (settings?.value) {
      enabled = JSON.parse(settings.value)
    }
  } catch (err) {
    // Settings table might not exist yet, use empty list
    enabled = []
  }

  return loadPlugins(dir, { enabled, context })
}

/**
 * Save enabled plugins to database
 *
 * @param {Object} db - Database instance
 * @param {string[]} enabled - List of enabled plugin names
 */
export async function saveEnabledPlugins(db, enabled) {
  const value = JSON.stringify(enabled)

  await db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = ?`,
    ['enabled_plugins', value, value]
  )
}
