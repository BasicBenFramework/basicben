/**
 * Load all themes from a directory
 *
 * @param {string} dir - Directory to scan (default: themes)
 * @param {Object} options - Loading options
 * @param {string} options.activeTheme - Theme to activate after loading
 * @param {Object} options.context - Application context
 * @returns {Promise<{loaded: string[], errors: Array<{name: string, error: string}>}>}
 */
export function loadThemes(dir?: string, options?: {
    activeTheme: string;
    context: any;
}): Promise<{
    loaded: string[];
    errors: Array<{
        name: string;
        error: string;
    }>;
}>;
/**
 * Scan themes directory without loading them
 *
 * @param {string} dir - Directory to scan
 * @returns {Array<{slug: string, name: string, path: string, hasConfig: boolean}>}
 */
export function scanThemes(dir?: string): Array<{
    slug: string;
    name: string;
    path: string;
    hasConfig: boolean;
}>;
/**
 * Get the main CSS file path for a theme
 *
 * @param {string} slug - Theme slug
 * @param {string} dir - Themes directory
 * @returns {string|null}
 */
export function getThemeStylePath(slug: string, dir?: string): string | null;
/**
 * Get the variables CSS file path for a theme
 *
 * @param {string} slug - Theme slug
 * @param {string} dir - Themes directory
 * @returns {string|null}
 */
export function getThemeVariablesPath(slug: string, dir?: string): string | null;
