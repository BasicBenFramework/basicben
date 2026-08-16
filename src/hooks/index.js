/**
 * Hook System for BasicBen CMS
 *
 * Provides WordPress-like action and filter hooks for extensibility.
 * Plugins and themes can register callbacks that fire at specific points.
 */

/**
 * Hook Manager - Central registry for all hooks
 *
 * @example
 * // Register a hook callback
 * hooks.on('server.started', async (ctx) => {
 *   console.log('Server is ready!')
 * })
 *
 * // Fire all callbacks for a hook (action)
 * await hooks.fire('server.started', { port: 3000 })
 *
 * // Filter data through callbacks
 * const html = await hooks.filter('content.render', rawHtml, { post })
 */
export class HookManager {
  constructor() {
    /** @type {Map<string, Array<{callback: Function, priority: number, name?: string}>>} */
    this.hooks = new Map()
  }

  /**
   * Register a callback for a hook
   *
   * @param {string} hook - Hook name (e.g., 'server.started')
   * @param {Function} callback - Function to call when hook fires
   * @param {Object} options - Options
   * @param {number} options.priority - Lower numbers run first (default: 10)
   * @param {string} options.name - Optional name for debugging/removal
   * @returns {this}
   */
  on(hook, callback, options = {}) {
    const { priority = 10, name } = options

    if (typeof callback !== 'function') {
      throw new Error(`Hook callback must be a function, got ${typeof callback}`)
    }

    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, [])
    }

    const callbacks = this.hooks.get(hook)
    callbacks.push({ callback, priority, name })

    // Keep sorted by priority (lower numbers first)
    callbacks.sort((a, b) => a.priority - b.priority)

    return this
  }

  /**
   * Remove a callback from a hook
   *
   * @param {string} hook - Hook name
   * @param {Function|string} callbackOrName - The callback function or its name
   * @returns {boolean} - Whether a callback was removed
   */
  off(hook, callbackOrName) {
    if (!this.hooks.has(hook)) {
      return false
    }

    const callbacks = this.hooks.get(hook)
    const initialLength = callbacks.length

    const filtered = callbacks.filter(item => {
      if (typeof callbackOrName === 'function') {
        return item.callback !== callbackOrName
      }
      return item.name !== callbackOrName
    })

    this.hooks.set(hook, filtered)
    return filtered.length < initialLength
  }

  /**
   * Fire all callbacks for a hook (action pattern)
   * Callbacks are executed in priority order.
   *
   * @param {string} hook - Hook name
   * @param {Object} context - Context object passed to callbacks
   * @returns {Promise<void>}
   */
  async fire(hook, context = {}) {
    if (!this.hooks.has(hook)) {
      return
    }

    const callbacks = this.hooks.get(hook)

    for (const { callback, name } of callbacks) {
      try {
        await callback(context)
      } catch (err) {
        // One broken callback must not stop the others, or a single bad plugin
        // silently disables every other plugin listening to the same hook.
        reportHookError(hook, name, err)
      }
    }
  }

  /**
   * Fire callbacks that transform data (filter pattern)
   * Each callback receives the value from the previous callback.
   *
   * @param {string} hook - Hook name
   * @param {*} value - Initial value to filter
   * @param {Object} context - Additional context passed to callbacks
   * @returns {Promise<*>} - Filtered value
   */
  async filter(hook, value, context = {}) {
    if (!this.hooks.has(hook)) {
      return value
    }

    const callbacks = this.hooks.get(hook)
    let filteredValue = value

    for (const { callback, name } of callbacks) {
      try {
        const result = await callback(filteredValue, context)
        // Only update if callback returns a value
        if (result !== undefined) {
          filteredValue = result
        }
      } catch (err) {
        // The value from before this callback carries on, so a broken filter
        // costs its own contribution and nothing else.
        reportHookError(hook, name, err)
      }
    }

    return filteredValue
  }

  /**
   * Check if a hook has any registered callbacks
   *
   * @param {string} hook - Hook name
   * @returns {boolean}
   */
  has(hook) {
    return this.hooks.has(hook) && this.hooks.get(hook).length > 0
  }

  /**
   * Get the count of callbacks for a hook
   *
   * @param {string} hook - Hook name
   * @returns {number}
   */
  count(hook) {
    if (!this.hooks.has(hook)) {
      return 0
    }
    return this.hooks.get(hook).length
  }

  /**
   * Get all registered hook names
   *
   * @returns {string[]}
   */
  list() {
    return Array.from(this.hooks.keys())
  }

  /**
   * Clear all callbacks for a hook (or all hooks)
   *
   * @param {string} [hook] - Optional hook name. If omitted, clears all hooks.
   * @returns {this}
   */
  clear(hook) {
    if (hook) {
      this.hooks.delete(hook)
    } else {
      this.hooks.clear()
    }
    return this
  }

  /**
   * Register multiple hooks at once from an object
   *
   * @param {Object<string, Function>} hookMap - Object mapping hook names to callbacks
   * @param {Object} options - Options passed to each registration
   * @returns {this}
   */
  registerMany(hookMap, options = {}) {
    for (const [hook, callback] of Object.entries(hookMap)) {
      this.on(hook, callback, options)
    }
    return this
  }
}

// Global hook manager instance
/**
 * Report a callback that threw.
 *
 * A hook error used to surface as `Error in hook "request.before": x` with no
 * indication of *which* plugin was at fault — on a site with several plugins
 * listening to the same hook, that is not enough to act on. Callbacks are
 * registered with a `plugin:hook` name, so it is available; it just was not
 * being used.
 *
 * The stack is kept on the error rather than printed, so a caller that wants
 * the detail can have it without every request logging twenty lines.
 */
function reportHookError(hook, name, err) {
  const source = name ? ` (${name})` : ''

  console.error(`Hook "${hook}"${source} threw: ${err.message}`)

  if (process.env.BASICBEN_DEBUG_HOOKS) {
    console.error(err.stack)
  }
}

export const hooks = new HookManager()

// Core hook names as constants for type safety and documentation
export const HOOKS = {
  // Server lifecycle
  SERVER_STARTING: 'server.starting',
  SERVER_STARTED: 'server.started',
  SERVER_STOPPING: 'server.stopping',

  // Request lifecycle
  REQUEST_BEFORE: 'request.before',
  REQUEST_AFTER: 'request.after',
  REQUEST_ERROR: 'request.error',

  // Content hooks
  CONTENT_RENDER: 'content.render',
  CONTENT_SAVE: 'content.save',
  CONTENT_DELETE: 'content.delete',

  // Post hooks
  POST_CREATING: 'post.creating',
  POST_CREATED: 'post.created',
  POST_UPDATING: 'post.updating',
  POST_UPDATED: 'post.updated',
  POST_DELETING: 'post.deleting',
  POST_DELETED: 'post.deleted',

  // Page hooks
  PAGE_CREATING: 'page.creating',
  PAGE_CREATED: 'page.created',
  PAGE_UPDATING: 'page.updating',
  PAGE_UPDATED: 'page.updated',

  // Comment hooks
  COMMENT_CREATING: 'comment.creating',
  COMMENT_CREATED: 'comment.created',
  COMMENT_APPROVED: 'comment.approved',

  // Auth hooks
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_REGISTER: 'auth.register',

  // Admin hooks
  ADMIN_MENU: 'admin.menu',
  ADMIN_DASHBOARD: 'admin.dashboard',
  ADMIN_INIT: 'admin.init',

  // Theme hooks
  THEME_ACTIVATED: 'theme.activated',
  THEME_RENDER: 'theme.render',

  // Plugin hooks
  PLUGIN_ACTIVATED: 'plugin.activated',
  PLUGIN_DEACTIVATED: 'plugin.deactivated',

  // Media hooks
  MEDIA_UPLOADING: 'media.uploading',
  MEDIA_UPLOADED: 'media.uploaded',
  MEDIA_DELETED: 'media.deleted',

  // Mail hooks. MAIL_SENDING is a filter: return the message to alter it, or
  // set cancelled to suppress the send.
  MAIL_SENDING: 'mail.sending',
  MAIL_SENT: 'mail.sent',
  MAIL_FAILED: 'mail.failed',

  // Verification hooks
  EMAIL_VERIFICATION_SENT: 'email.verification.sent',
  EMAIL_VERIFIED: 'email.verified'
}
