/**
 * Get the current environment configuration
 * @returns {object} Environment info
 */
export function getEnvironment(): object;
/**
 * Check if running in BasicBen Cloud
 * @returns {boolean}
 */
export function isCloud(): boolean;
/**
 * Check if running in self-hosted mode
 * @returns {boolean}
 */
export function isSelfHosted(): boolean;
/**
 * Get the tenant ID (cloud only)
 * @returns {string|null}
 */
export function getTenantId(): string | null;
/**
 * Get the deployment region (cloud only)
 * @returns {string|null}
 */
export function getRegion(): string | null;
/**
 * Get the current BasicBen version
 * @returns {string}
 */
export function getVersion(): string;
/**
 * Check if manual updates are allowed
 * @returns {boolean}
 */
export function canManualUpdate(): boolean;
/**
 * Check if plugin installation is allowed
 * @returns {boolean}
 */
export function canInstallPlugins(): boolean;
/**
 * Check if theme installation is allowed
 * @returns {boolean}
 */
export function canInstallThemes(): boolean;
/**
 * Get the update channel
 * @returns {string} 'stable', 'beta', or 'dev'
 */
export function getUpdateChannel(): string;
/**
 * Get license key
 * @returns {string|null}
 */
export function getLicenseKey(): string | null;
/**
 * Assert that running in self-hosted mode
 * @throws {Error} If running in cloud mode
 */
export function assertSelfHosted(): void;
/**
 * Assert that running in cloud mode
 * @throws {Error} If running in self-hosted mode
 */
export function assertCloud(): void;
