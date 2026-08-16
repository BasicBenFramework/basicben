/**
 * Theme configuration object
 *
 * @typedef {Object} ThemeConfig
 * @property {string} name - Theme display name
 * @property {string} version - Semver version string
 * @property {string} [description] - Theme description
 * @property {string} [author] - Author name
 * @property {string} [screenshot] - Path to screenshot image
 * @property {Object} [settings] - Default theme settings
 * @property {Object} [layouts] - Map of layout names to components
 * @property {Object} [components] - Map of component names to components
 */
/**
 * Theme Manager - Central registry for all themes
 *
 * @example
 * // Register a theme
 * themes.register({
 *   name: 'Default Theme',
 *   version: '1.0.0',
 *   slug: 'default',
 *   settings: {
 *     colors: { primary: '#6366f1' },
 *     fonts: { heading: 'Inter' }
 *   }
 * })
 *
 * // Activate theme
 * await themes.activate('default')
 *
 * // Get theme settings
 * const settings = themes.getSettings()
 */
export class ThemeManager {
    /** @type {Map<string, ThemeConfig>} */
    themes: Map<string, ThemeConfig>;
    /** @type {string} */
    activeTheme: string;
    /** @type {Map<string, Object>} */
    themeSettings: Map<string, any>;
    /** @type {Object} */
    context: any;
    /**
     * Set the application context for themes
     *
     * @param {Object} context - Application context object
     */
    setContext(context: any): void;
    /**
     * Register a theme
     *
     * @param {ThemeConfig} config - Theme configuration
     * @returns {this}
     */
    register(config: ThemeConfig): this;
    /**
     * Activate a theme
     *
     * @param {string} slug - Theme slug
     * @returns {Promise<boolean>}
     */
    activate(slug: string): Promise<boolean>;
    /**
     * Get the active theme config
     *
     * @returns {ThemeConfig|undefined}
     */
    getActive(): ThemeConfig | undefined;
    /**
     * Get theme by slug
     *
     * @param {string} slug - Theme slug
     * @returns {ThemeConfig|undefined}
     */
    get(slug: string): ThemeConfig | undefined;
    /**
     * List all registered themes
     *
     * @returns {Array<{slug: string, name: string, version: string, active: boolean, description?: string}>}
     */
    list(): Array<{
        slug: string;
        name: string;
        version: string;
        active: boolean;
        description?: string;
    }>;
    /**
     * Get active theme settings
     *
     * @returns {Object}
     */
    getSettings(): any;
    /**
     * Get settings for a specific theme
     *
     * @param {string} slug - Theme slug
     * @returns {Object}
     */
    getThemeSettings(slug: string): any;
    /**
     * Update theme settings
     *
     * @param {Object} settings - New settings (merged with existing)
     * @param {string} [slug] - Theme slug (defaults to active theme)
     * @returns {Object} - Updated settings
     */
    updateSettings(settings: any, slug?: string): any;
    /**
     * Reset theme settings to defaults
     *
     * @param {string} [slug] - Theme slug (defaults to active theme)
     * @returns {Object} - Default settings
     */
    resetSettings(slug?: string): any;
    /**
     * Get layout component from active theme
     *
     * @param {string} layoutName - Layout name (e.g., 'default', 'post', 'page')
     * @returns {Function|undefined} - React component or undefined
     */
    getLayout(layoutName: string): Function | undefined;
    /**
     * Get component from active theme
     *
     * @param {string} componentName - Component name (e.g., 'Header', 'Footer')
     * @returns {Function|undefined} - React component or undefined
     */
    getComponent(componentName: string): Function | undefined;
    /**
     * Check if a theme is active
     *
     * @param {string} slug - Theme slug
     * @returns {boolean}
     */
    isActive(slug: string): boolean;
    /**
     * Unregister a theme
     *
     * @param {string} slug - Theme slug
     * @returns {boolean}
     */
    unregister(slug: string): boolean;
    /**
     * Get CSS variables for active theme
     *
     * @returns {Object} - CSS custom properties
     */
    getCssVariables(): any;
    /**
     * Generate CSS variables string
     *
     * @returns {string} - CSS rules
     */
    generateCss(): string;
}
export const themes: ThemeManager;
/**
 * Theme configuration object
 */
export type ThemeConfig = {
    /**
     * - Theme display name
     */
    name: string;
    /**
     * - Semver version string
     */
    version: string;
    /**
     * - Theme description
     */
    description?: string;
    /**
     * - Author name
     */
    author?: string;
    /**
     * - Path to screenshot image
     */
    screenshot?: string;
    /**
     * - Default theme settings
     */
    settings?: any;
    /**
     * - Map of layout names to components
     */
    layouts?: any;
    /**
     * - Map of component names to components
     */
    components?: any;
};
