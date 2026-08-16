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
    /** @type {Map<string, PluginConfig>} */
    plugins: Map<string, PluginConfig>;
    /** @type {Set<string>} */
    activePlugins: Set<string>;
    /** @type {Map<string, Object>} */
    pluginSettings: Map<string, any>;
    /** @type {Object} */
    context: any;
    /**
     * Set the application context (db, router, etc.) for plugins
     *
     * @param {Object} context - Application context object
     */
    setContext(context: any): void;
    /**
     * Register a plugin
     *
     * @param {PluginConfig} config - Plugin configuration
     * @returns {this}
     */
    register(config: PluginConfig): this;
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
    activate(name: string, options?: any): Promise<boolean>;
    /**
     * Deactivate a plugin
     *
     * @param {string} name - Plugin name
     * @returns {Promise<boolean>}
     */
    deactivate(name: string): Promise<boolean>;
    /**
     * Check if a plugin is active
     *
     * @param {string} name - Plugin name
     * @returns {boolean}
     */
    isActive(name: string): boolean;
    /**
     * Get plugin info
     *
     * @param {string} name - Plugin name
     * @returns {PluginConfig|undefined}
     */
    get(name: string): PluginConfig | undefined;
    /**
     * Get all registered plugins
     *
     * @returns {Array<{name: string, version: string, active: boolean, description?: string}>}
     */
    list(): Array<{
        name: string;
        version: string;
        active: boolean;
        description?: string;
    }>;
    /**
     * Get active plugins
     *
     * @returns {string[]}
     */
    getActive(): string[];
    /**
     * Get plugin settings
     *
     * @param {string} name - Plugin name
     * @returns {Object}
     */
    getSettings(name: string): any;
    /**
     * Update plugin settings
     *
     * @param {string} name - Plugin name
     * @param {Object} settings - New settings (merged with existing)
     * @returns {Object} - Updated settings
     */
    updateSettings(name: string, settings: any): any;
    /**
     * Unregister a plugin (removes from registry)
     *
     * @param {string} name - Plugin name
     * @returns {Promise<boolean>}
     */
    unregister(name: string): Promise<boolean>;
    /**
     * Activate all registered plugins that are marked as enabled
     *
     * @param {string[]} [enabledList] - List of plugin names to activate
     * @returns {Promise<void>}
     */
    activateAll(enabledList?: string[]): Promise<void>;
    /**
     * Deactivate all active plugins
     *
     * @returns {Promise<void>}
     */
    deactivateAll(): Promise<void>;
}
export const plugins: PluginManager;
/**
 * Plugin configuration object
 */
export type PluginConfig = {
    /**
     * - Unique plugin identifier
     */
    name: string;
    /**
     * - Semver version string
     */
    version: string;
    /**
     * - Plugin description
     */
    description?: string;
    /**
     * - Author name or email
     */
    author?: string;
    /**
     * - Hook callbacks to register
     */
    hooks?: {
        [x: string]: Function;
    };
    /**
     * - Called when plugin is activated
     */
    initialize?: Function;
    /**
     * - Called when plugin is deactivated
     */
    destroy?: Function;
    /**
     * - Function to register routes (receives router)
     */
    routes?: Function;
    /**
     * - Middleware functions to register
     */
    middleware?: Function[];
    /**
     * - Default plugin settings
     */
    settings?: any;
};
