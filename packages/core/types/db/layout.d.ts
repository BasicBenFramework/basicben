/**
 * Refuse to run against a project that still uses the pre-0.3.0 layout.
 *
 * @param {string} dir - Absolute path that should hold the files
 * @param {string} legacy - Old project-relative directory ('migrations')
 * @param {string} current - New project-relative directory ('db/migrations')
 * @throws {Error} when the old directory exists and the new one does not
 */
export function refuseLegacyLayout(dir: string, legacy: string, current: string): void;
