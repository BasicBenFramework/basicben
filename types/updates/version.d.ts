/**
 * Version comparison and parsing utilities
 */
/**
 * Parse a semver version string into components
 * @param {string} version - Version string (e.g., "1.2.3", "1.2.3-beta.1")
 * @returns {object} Parsed version object
 */
export function parseVersion(version: string): object;
/**
 * Compare two version strings
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {number} -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number;
/**
 * Check if version A is newer than version B
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {boolean} True if a > b
 */
export function isNewer(a: string, b: string): boolean;
/**
 * Check if version A is older than version B
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {boolean} True if a < b
 */
export function isOlder(a: string, b: string): boolean;
/**
 * Check if two versions are equal
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {boolean} True if a == b
 */
export function isEqual(a: string, b: string): boolean;
/**
 * Check if a version satisfies a requirement
 * Supports: >=, >, <=, <, =, ^, ~
 * @param {string} required - Requirement string (e.g., ">=1.0.0", "^2.0.0")
 * @param {string} current - Version to check
 * @returns {boolean} True if current satisfies required
 */
export function satisfies(required: string, current: string): boolean;
/**
 * Get the release channel from a version
 * @param {string} version - Version string
 * @returns {string} Channel: 'stable', 'beta', 'alpha', 'dev', or 'rc'
 */
export function getChannel(version: string): string;
/**
 * Get the next version based on release type
 * @param {string} current - Current version
 * @param {string} type - Release type: 'major', 'minor', 'patch', 'prerelease'
 * @returns {string} Next version
 */
export function incrementVersion(current: string, type?: string): string;
