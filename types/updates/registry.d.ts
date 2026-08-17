/**
 * Registry client for communicating with BasicBen registries
 */
export class RegistryClient {
    /**
     * Create a new registry client
     * @param {object} options - Configuration options
     * @param {string[]} options.registries - List of registry URLs
     * @param {string} options.channel - Release channel (stable, beta, dev)
     * @param {string} options.license - License key for premium content
     * @param {number} options.timeout - Request timeout in ms
     */
    constructor(options?: {
        registries: string[];
        channel: string;
        license: string;
        timeout: number;
    });
    registries: string[];
    channel: string;
    license: string;
    timeout: number;
    cache: Map<any, any>;
    cacheTimeout: any;
    unreachable: Map<any, any>;
    unreachableFor: any;
    /**
     * Make an HTTP request
     * @param {string} url - Full URL to request
     * @param {object} options - Request options
     * @returns {Promise<object>} Response data
     */
    request(url: string, options?: object): Promise<object>;
    /**
     * Get cached data or fetch fresh
     * @param {string} key - Cache key
     * @param {Function} fetcher - Function to fetch data
     * @returns {Promise<any>} Cached or fresh data
     */
    getCached(key: string, fetcher: Function): Promise<any>;
    /**
     * Clear the cache
     */
    clearCache(): void;
    /**
     * Try request across all registries, return first success
     * @param {string} path - API path
     * @returns {Promise<object|null>} Response data
     */
    tryRegistries(path: string): Promise<object | null>;
    /**
     * Get latest core version info
     * @returns {Promise<object>} Core version info
     */
    getLatestCore(): Promise<object>;
    /**
     * Get all available core versions
     * @returns {Promise<object[]>} List of versions
     */
    getCoreVersions(): Promise<object[]>;
    /**
     * Get core version changelog
     * @param {string} version - Version to get changelog for
     * @returns {Promise<string|null>} Changelog markdown, or null if no registry
     *   has one for that version
     */
    getCoreChangelog(version: string): Promise<string | null>;
    /**
     * Get download URL for core update
     * @param {string} version - Version to download
     * @returns {Promise<object>} Download info with URL and checksum
     */
    getCoreDownload(version: string): Promise<object>;
    /**
     * Search plugins in registry
     * @param {object} options - Search options
     * @param {string} options.search - Search query
     * @param {string} options.category - Category filter
     * @param {number} options.page - Page number
     * @param {number} options.limit - Results per page
     * @returns {Promise<object>} Search results
     */
    searchPlugins(options?: {
        search: string;
        category: string;
        page: number;
        limit: number;
    }): Promise<object>;
    /**
     * Get plugin details
     * @param {string} slug - Plugin slug
     * @returns {Promise<object|null>} Plugin details
     */
    getPlugin(slug: string): Promise<object | null>;
    /**
     * Get download URL for plugin
     * @param {string} slug - Plugin slug
     * @param {string} version - Version to download (default: latest)
     * @returns {Promise<object>} Download info
     */
    getPluginDownload(slug: string, version?: string): Promise<object>;
    /**
     * Check for plugin updates
     * @param {object[]} installed - List of installed plugins with slug and version
     * @returns {Promise<object[]>} List of available updates
     */
    checkPluginUpdates(installed: object[]): Promise<object[]>;
    /**
     * Validate license key
     * @param {string} key - License key
     * @returns {Promise<object>} License info
     */
    validateLicense(key: string): Promise<object>;
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
     * Set registry priority (move to front)
     * @param {string} url - Registry URL
     */
    prioritizeRegistry(url: string): void;
    /**
     * Get list of registries
     * @returns {string[]} Registry URLs
     */
    getRegistries(): string[];
    /**
     * Check if a registry is reachable
     * @param {string} url - Registry URL
     * @returns {Promise<boolean>} True if reachable
     */
    pingRegistry(url: string): Promise<boolean>;
    #private;
}
export const registry: RegistryClient;
