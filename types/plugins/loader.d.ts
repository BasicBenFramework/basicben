/**
 * Load all plugins from a directory
 *
 * @param {string} dir - Directory to scan (default: plugins)
 * @param {Object} options - Loading options
 * @param {string[]} options.enabled - List of plugin names to auto-activate
 * @param {Object} options.context - Application context (db, router, etc.)
 * @returns {Promise<{loaded: string[], activated: string[], errors: Array<{name: string, error: string}>}>}
 *
 * @example
 * // Load all plugins from 'plugins' directory
 * const result = await loadPlugins('plugins', {
 *   enabled: ['hello-world', 'seo-plugin'],
 *   context: { db, router }
 * })
 */
export function loadPlugins(dir?: string, options?: {
    enabled: string[];
    context: any;
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
