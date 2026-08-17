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
export function loadPlugins(dir?: string | false, options?: {
    enabled?: string[];
    context?: any;
    modules?: Array<any>;
}): Promise<{
    loaded: string[];
    activated: string[];
    errors: Array<{
        name: string;
        error: string;
    }>;
}>;
/**
 * Get list of available plugins from directory (without loading them)
 *
 * @param {string} dir - Directory to scan
 * @returns {Array<{name: string, path: string, type: 'file'|'directory'}>}
 */
export function scanPlugins(dir?: string): Array<{
    name: string;
    path: string;
    type: "file" | "directory";
}>;
/**
 * Load enabled plugins from a config file or database
 *
 * @param {Object} db - Database instance
 * @param {string} dir - Plugins directory
 * @param {Object} context - Application context
 * @returns {Promise<Object>}
 */
export function loadEnabledPlugins(db: any, dir?: string, context?: any): Promise<any>;
/**
 * Save enabled plugins to database
 *
 * @param {Object} db - Database instance
 * @param {string[]} enabled - List of enabled plugin names
 */
export function saveEnabledPlugins(db: any, enabled: string[]): Promise<void>;
