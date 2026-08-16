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
    /** @type {Map<string, Array<{callback: Function, priority: number, name?: string}>>} */
    hooks: Map<string, Array<{
        callback: Function;
        priority: number;
        name?: string;
    }>>;
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
    on(hook: string, callback: Function, options?: {
        priority: number;
        name: string;
    }): this;
    /**
     * Remove a callback from a hook
     *
     * @param {string} hook - Hook name
     * @param {Function|string} callbackOrName - The callback function or its name
     * @returns {boolean} - Whether a callback was removed
     */
    off(hook: string, callbackOrName: Function | string): boolean;
    /**
     * Fire all callbacks for a hook (action pattern)
     * Callbacks are executed in priority order.
     *
     * @param {string} hook - Hook name
     * @param {Object} context - Context object passed to callbacks
     * @returns {Promise<void>}
     */
    fire(hook: string, context?: any): Promise<void>;
    /**
     * Fire callbacks that transform data (filter pattern)
     * Each callback receives the value from the previous callback.
     *
     * @param {string} hook - Hook name
     * @param {*} value - Initial value to filter
     * @param {Object} context - Additional context passed to callbacks
     * @returns {Promise<*>} - Filtered value
     */
    filter(hook: string, value: any, context?: any): Promise<any>;
    /**
     * Check if a hook has any registered callbacks
     *
     * @param {string} hook - Hook name
     * @returns {boolean}
     */
    has(hook: string): boolean;
    /**
     * Get the count of callbacks for a hook
     *
     * @param {string} hook - Hook name
     * @returns {number}
     */
    count(hook: string): number;
    /**
     * Get all registered hook names
     *
     * @returns {string[]}
     */
    list(): string[];
    /**
     * Clear all callbacks for a hook (or all hooks)
     *
     * @param {string} [hook] - Optional hook name. If omitted, clears all hooks.
     * @returns {this}
     */
    clear(hook?: string): this;
    /**
     * Register multiple hooks at once from an object
     *
     * @param {Object<string, Function>} hookMap - Object mapping hook names to callbacks
     * @param {Object} options - Options passed to each registration
     * @returns {this}
     */
    registerMany(hookMap: {
        [x: string]: Function;
    }, options?: any): this;
}
export const hooks: HookManager;
export namespace HOOKS {
    let SERVER_STARTING: string;
    let SERVER_STARTED: string;
    let SERVER_STOPPING: string;
    let REQUEST_BEFORE: string;
    let REQUEST_AFTER: string;
    let REQUEST_ERROR: string;
    let CONTENT_RENDER: string;
    let CONTENT_SAVE: string;
    let CONTENT_DELETE: string;
    let POST_CREATING: string;
    let POST_CREATED: string;
    let POST_UPDATING: string;
    let POST_UPDATED: string;
    let POST_DELETING: string;
    let POST_DELETED: string;
    let PAGE_CREATING: string;
    let PAGE_CREATED: string;
    let PAGE_UPDATING: string;
    let PAGE_UPDATED: string;
    let COMMENT_CREATING: string;
    let COMMENT_CREATED: string;
    let COMMENT_APPROVED: string;
    let AUTH_LOGIN: string;
    let AUTH_LOGOUT: string;
    let AUTH_REGISTER: string;
    let ADMIN_MENU: string;
    let ADMIN_DASHBOARD: string;
    let ADMIN_INIT: string;
    let THEME_ACTIVATED: string;
    let THEME_RENDER: string;
    let PLUGIN_ACTIVATED: string;
    let PLUGIN_DEACTIVATED: string;
    let MEDIA_UPLOADING: string;
    let MEDIA_UPLOADED: string;
    let MEDIA_DELETED: string;
    let MAIL_SENDING: string;
    let MAIL_SENT: string;
    let MAIL_FAILED: string;
    let EMAIL_VERIFICATION_SENT: string;
    let EMAIL_VERIFIED: string;
}
