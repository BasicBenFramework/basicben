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
 * Load all plugins from a directory
 *
 * @param {string} dir - Directory to scan (default: plugins)
 * @param {Object} [options] - Loading options
 * @param {string[]} [options.enabled] - Plugin names to auto-activate
 * @param {Object} [options.context] - Application context (db, router, etc.)
 * @returns {Promise<{loaded: string[], activated: string[], errors: Array<{name: string, error: string}>}>}
 *
 * @example
 * // Load all plugins from 'plugins' directory
 * const result = await loadPlugins('plugins', {
 *   enabled: ['hello-world', 'seo-plugin'],
 *   context: { db, router }
 * })
 */
export async function loadPlugins(dir = 'plugins', options = {}) {
  const { enabled = [], context = {} } = options
  const pluginsDir = resolve(process.cwd(), dir)

  const result = {
    loaded: [],
    activated: [],
    errors: []
  }

  if (!existsSync(pluginsDir)) {
    return result
  }

  // Set context for plugins
  plugins.setContext(context)

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

      if (pluginConfig) {
        plugins.register(pluginConfig)
        result.loaded.push(pluginConfig.name)

        // Auto-activate if in enabled list. A plugin that fails to activate is
        // recorded and skipped rather than taking the boot down with it — one
        // broken plugin should not stop the site serving.
        if (enabled.includes(pluginConfig.name)) {
          try {
            await plugins.activate(pluginConfig.name)
            result.activated.push(pluginConfig.name)
          } catch (err) {
            result.errors.push({ name: pluginConfig.name, error: err.message })
            console.error(`Plugin "${pluginConfig.name}" was not activated:`, err.message)
          }
        }
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
