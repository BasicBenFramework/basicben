/**
 * Update Manager for BasicBen
 */
export class UpdateManager {
    /**
     * Create a new UpdateManager
     * @param {object} config - Configuration options
     */
    constructor(config?: object);
    config: any;
    registry: RegistryClient;
    currentVersion: string;
    lastCheck: number;
    cachedUpdates: {
        core: {
            available: boolean;
            current?: string;
            latest?: string;
            channel?: string;
            releaseDate?: string;
            changelog?: string;
            migrations?: object[];
            minNode?: string;
            error?: string;
        };
        plugins: any[];
    };
    /**
     * Check for all available updates
     * @param {boolean} force - Force fresh check (ignore cache)
     * @returns {Promise<{ core: CoreUpdate|null, plugins: object[] }>}
     *   Update info for core and plugins
     */
    checkAll(force?: boolean): Promise<{
        core: {
            available: boolean;
            current?: string;
            latest?: string;
            channel?: string;
            releaseDate?: string;
            changelog?: string;
            migrations?: object[];
            minNode?: string;
            error?: string;
        } | null;
        plugins: object[];
    }>;
    /**
     * What a core update check reports.
     *
     * `available` is the only field always present: a failed check reports
     * `available: false` with the reason rather than throwing, so a registry
     * being down never takes the admin area with it.
     *
     * @typedef {Object} CoreUpdate
     * @property {boolean} available
     * @property {string} [current]
     * @property {string} [latest]
     * @property {string} [channel]
     * @property {string} [releaseDate]
     * @property {string} [changelog]
     * @property {object[]} [migrations]
     * @property {string} [minNode]
     * @property {string} [error]
     */
    /**
     * The outcome of an install or update. Failures throw, so `success` is
     * always true here — it is carried through to the JSON an admin route sends.
     *
     * @typedef {Object} UpdateResult
     * @property {boolean} success
     * @property {string} [version]
     * @property {string} [previousVersion]
     * @property {string} [slug]
     * @property {string} [message]
     */
    /**
     * Check for core framework updates
     * @returns {Promise<CoreUpdate|null>} Update info or null if up to date
     */
    checkCoreUpdate(): Promise<{
        available: boolean;
        current?: string;
        latest?: string;
        channel?: string;
        releaseDate?: string;
        changelog?: string;
        migrations?: object[];
        minNode?: string;
        error?: string;
    } | null>;
    /**
     * Check for plugin updates
     * @returns {Promise<object[]>} List of available updates
     */
    checkPluginUpdates(): Promise<object[]>;
    /**
     * Update the core framework
     * @param {string} version - Target version (default: latest)
     * @param {object} options - Update options
     * @returns {Promise<UpdateResult>} Update result
     */
    updateCore(version?: string, options?: object): Promise<{
        success: boolean;
        version?: string;
        previousVersion?: string;
        slug?: string;
        message?: string;
    }>;
    /**
     * Install a plugin from registry
     * @param {string} slug - Plugin slug
     * @param {object} options - Install options
     * @returns {Promise<UpdateResult>} Install result
     */
    installPlugin(slug: string, options?: object): Promise<{
        success: boolean;
        version?: string;
        previousVersion?: string;
        slug?: string;
        message?: string;
    }>;
    /**
     * Update an installed plugin
     * @param {string} slug - Plugin slug
     * @param {object} options - Update options
     * @returns {Promise<UpdateResult>} Update result
     */
    updatePlugin(slug: string, options?: object): Promise<{
        success: boolean;
        version?: string;
        previousVersion?: string;
        slug?: string;
        message?: string;
    }>;
    /**
     * Remove a plugin
     * @param {string} slug - Plugin slug
     * @returns {Promise<object>} Remove result
     */
    removePlugin(slug: string): Promise<object>;
    /**
     * Create a backup
     * @param {string} type - Backup type (pre-update, manual, etc.)
     * @returns {Promise<object>} Backup info
     */
    createBackup(type?: string): Promise<object>;
    /**
     * List available backups
     * @returns {Promise<object[]>} List of backups
     */
    listBackups(): Promise<object[]>;
    /**
     * Restore from a backup
     * @param {string} backupId - Backup ID to restore
     * @returns {Promise<object>} Restore result
     */
    restoreBackup(backupId: string): Promise<object>;
    /**
     * Delete a backup
     * @param {string} backupId - Backup ID to delete
     * @returns {Promise<void>}
     */
    deleteBackup(backupId: string): Promise<void>;
    /**
     * Cleanup old backups (keep maxBackups)
     * @returns {Promise<void>}
     */
    cleanupBackups(): Promise<void>;
    /**
     * Add a registry
     * @param {string} url - Registry URL
     */
    addRegistry(url: string): void;
    /**
     * Remove a registry
     * @param {string} url - Registry URL
     */
    removeRegistry(url: string): void;
    /**
     * Get list of registries
     * @returns {string[]}
     */
    getRegistries(): string[];
    /**
     * Set license key
     * @param {string} key - License key
     */
    setLicense(key: string): void;
    /**
     * Validate license key
     * @param {string} key - License key
     * @returns {Promise<object>} Validation result
     */
    validateLicense(key: string): Promise<object>;
    /**
     * Get installed plugins
     * @returns {Promise<object[]>}
     */
    /**
     * Every installed plugin, with the metadata the update checks need.
     *
     * Discovery is delegated to the loader rather than reimplemented. The second
     * implementation this replaces only looked at directories containing a
     * `plugin.json`, so single-file plugins — which the loader has always
     * supported, and which the shipped `hello-world.js` is one of — were invisible
     * to every update check.
     *
     * @returns {Promise<Array<{slug: string, name: string, version: string, description?: string}>>}
     */
    getInstalledPlugins(): Promise<Array<{
        slug: string;
        name: string;
        version: string;
        description?: string;
    }>>;
    /**
     * Update package.json with new framework version
     * @param {string} version - Target version
     */
    updatePackageJson(version: string): Promise<void>;
    /**
     * Run npm install
     */
    runNpmInstall(): Promise<any>;
    /**
     * Apply core migrations
     * @param {string} version - Version to apply migrations for
     */
    applyCoreMigrations(version: string): Promise<any>;
    /**
     * Clear caches
     */
    clearCaches(): Promise<void>;
}
export const updates: UpdateManager;
export * from "./version.js";
export { RegistryClient } from "./registry.js";
import { RegistryClient } from './registry.js';
