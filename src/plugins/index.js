/**
 * Plugin System for BasicBen CMS
 *
 * Provides a WordPress-like plugin architecture with Ghost's simplicity.
 * Plugins can extend functionality through hooks, routes, and middleware.
 */

import { hooks } from '../hooks/index.js'

/**
 * Plugin configuration object
 *
 * @typedef {Object} PluginConfig
 * @property {string} name - Unique plugin identifier
 * @property {string} version - Semver version string
 * @property {string} [description] - Plugin description
 * @property {string} [author] - Author name or email
 * @property {Object<string, Function>} [hooks] - Hook callbacks to register
 * @property {Function} [initialize] - Called when plugin is activated
 * @property {Function} [destroy] - Called when plugin is deactivated
 * @property {Function} [routes] - Function to register routes (receives router)
 * @property {Function[]} [middleware] - Middleware functions to register
 * @property {Object} [settings] - Default plugin settings
 */

/**
 * Plugin Manager - Central registry for all plugins
 *
 * @example
 * // Register a plugin
 * plugins.register({
 *   name: 'hello-world',
 *   version: '1.0.0',
 *   hooks: {
 *     'request.before': (ctx) => console.log('Request received!')
 *   },
 *   initialize: async () => console.log('Plugin initialized'),
 *   destroy: async () => console.log('Plugin destroyed')
 * })
 *
 * // Activate plugin
 * await plugins.activate('hello-world')
 *
 * // Deactivate plugin
 * await plugins.deactivate('hello-world')
 */
export class PluginManager {
  constructor() {
    /** @type {Map<string, PluginConfig>} */
    this.plugins = new Map()

    /** @type {Set<string>} */
    this.activePlugins = new Set()

    /** @type {Map<string, Object>} */
    this.pluginSettings = new Map()

    /** @type {Object} */
    this.context = {}
  }

  /**
   * Set the application context (db, router, etc.) for plugins
   *
   * @param {Object} context - Application context object
   */
  setContext(context) {
    this.context = context
  }

  /**
   * Register a plugin
   *
   * @param {PluginConfig} config - Plugin configuration
   * @returns {this}
   */
  register(config) {
    if (!config.name) {
      throw new Error('Plugin must have a name')
    }

    if (!config.version) {
      throw new Error(`Plugin "${config.name}" must have a version`)
    }

    if (this.plugins.has(config.name)) {
      console.warn(`Plugin "${config.name}" is already registered, replacing...`)
    }

    this.plugins.set(config.name, config)

    // Initialize default settings
    if (config.settings) {
      this.pluginSettings.set(config.name, { ...config.settings })
    }

    return this
  }

  /**
   * Activate a plugin
   *
   * Throws on failure rather than returning false. Returning a boolean that
   * callers did not check is why `basicben plugin activate` printed a tick
   * directly beneath "is not registered" and exited 0. Callers that want to
   * tolerate a failure — the loader, activating many plugins at boot — catch it
   * deliberately; callers that do not, surface it.
   *
   * @param {string} name - Plugin name
   * @param {Object} [options] - Activation options
   * @returns {Promise<boolean>} true, or throws
   * @throws {Error} when the plugin is not registered or its initialize fails
   */
  async activate(name, options = {}) {
    const plugin = this.plugins.get(name)

    if (!plugin) {
      const known = [...this.plugins.keys()]

      throw new Error(
        `Plugin "${name}" is not registered.` +
        (known.length
          ? ` Registered plugins: ${known.join(', ')}.`
          : ' No plugins have been loaded — call loadPlugins() first.')
      )
    }

    if (this.activePlugins.has(name)) {
      return true
    }

    try {
      // Register plugin hooks
      if (plugin.hooks) {
        for (const [hook, callback] of Object.entries(plugin.hooks)) {
          hooks.on(hook, callback, { name: `${name}:${hook}` })
        }
      }

      // Call initialize function
      if (typeof plugin.initialize === 'function') {
        await plugin.initialize({
          ...this.context,
          settings: this.getSettings(name),
          updateSettings: (settings) => this.updateSettings(name, settings)
        })
      }

      // Register routes if provided
      if (typeof plugin.routes === 'function' && this.context.router) {
        plugin.routes(this.context.router)
      }

      this.activePlugins.add(name)

      // Fire plugin activated hook
      await hooks.fire('plugin.activated', { plugin: name, config: plugin })

      return true
    } catch (err) {
      // Roll back the hooks bound above. A plugin whose initialize threw is not
      // active, and leaving its callbacks attached means a half-initialized
      // plugin still runs on every request.
      if (plugin.hooks) {
        for (const [hook, callback] of Object.entries(plugin.hooks)) {
          hooks.off(hook, callback)
        }
      }

      this.activePlugins.delete(name)

      throw new Error(`Plugin "${name}" failed to activate: ${err.message}`, { cause: err })
    }
  }

  /**
   * Deactivate a plugin
   *
   * @param {string} name - Plugin name
   * @returns {Promise<boolean>}
   */
  async deactivate(name) {
    const plugin = this.plugins.get(name)

    if (!plugin) {
      console.error(`Plugin "${name}" is not registered`)
      return false
    }

    if (!this.activePlugins.has(name)) {
      console.warn(`Plugin "${name}" is not active`)
      return true
    }

    try {
      // Unregister plugin hooks
      if (plugin.hooks) {
        for (const hook of Object.keys(plugin.hooks)) {
          hooks.off(hook, `${name}:${hook}`)
        }
      }

      // Call destroy function
      if (typeof plugin.destroy === 'function') {
        await plugin.destroy({
          ...this.context,
          settings: this.getSettings(name)
        })
      }

      this.activePlugins.delete(name)

      // Fire plugin deactivated hook
      await hooks.fire('plugin.deactivated', { plugin: name })

      console.log(`Plugin "${name}" deactivated`)
      return true
    } catch (err) {
      console.error(`Failed to deactivate plugin "${name}":`, err.message)
      return false
    }
  }

  /**
   * Check if a plugin is active
   *
   * @param {string} name - Plugin name
   * @returns {boolean}
   */
  isActive(name) {
    return this.activePlugins.has(name)
  }

  /**
   * Get plugin info
   *
   * @param {string} name - Plugin name
   * @returns {PluginConfig|undefined}
   */
  get(name) {
    return this.plugins.get(name)
  }

  /**
   * Get all registered plugins
   *
   * @returns {Array<{name: string, version: string, active: boolean, description?: string}>}
   */
  list() {
    const result = []

    for (const [name, config] of this.plugins) {
      result.push({
        name,
        version: config.version,
        description: config.description,
        author: config.author,
        active: this.activePlugins.has(name)
      })
    }

    return result
  }

  /**
   * Get active plugins
   *
   * @returns {string[]}
   */
  getActive() {
    return Array.from(this.activePlugins)
  }

  /**
   * Get plugin settings
   *
   * @param {string} name - Plugin name
   * @returns {Object}
   */
  getSettings(name) {
    return this.pluginSettings.get(name) || {}
  }

  /**
   * Update plugin settings
   *
   * @param {string} name - Plugin name
   * @param {Object} settings - New settings (merged with existing)
   * @returns {Object} - Updated settings
   */
  updateSettings(name, settings) {
    const current = this.pluginSettings.get(name) || {}
    const updated = { ...current, ...settings }
    this.pluginSettings.set(name, updated)
    return updated
  }

  /**
   * Unregister a plugin (removes from registry)
   *
   * @param {string} name - Plugin name
   * @returns {Promise<boolean>}
   */
  async unregister(name) {
    // Deactivate first if active
    if (this.activePlugins.has(name)) {
      await this.deactivate(name)
    }

    this.plugins.delete(name)
    this.pluginSettings.delete(name)

    return true
  }

  /**
   * Activate all registered plugins that are marked as enabled
   *
   * @param {string[]} [enabledList] - List of plugin names to activate
   * @returns {Promise<void>}
   */
  async activateAll(enabledList) {
    const toActivate = enabledList || Array.from(this.plugins.keys())

    for (const name of toActivate) {
      if (this.plugins.has(name)) {
        await this.activate(name)
      }
    }
  }

  /**
   * Deactivate all active plugins
   *
   * @returns {Promise<void>}
   */
  async deactivateAll() {
    const active = Array.from(this.activePlugins)

    for (const name of active) {
      await this.deactivate(name)
    }
  }
}

// Global plugin manager instance
export const plugins = new PluginManager()
