/**
 * Resolve a package's bin script from a project's node_modules
 *
 * @param {string} cwd - Project directory
 * @param {string} pkgName - Package name, e.g. 'vite'
 * @returns {string|null} Absolute path to the bin script, or null if not installed
 */
export function resolveBin(cwd: string, pkgName: string): string | null;
/**
 * Spawn a locally installed CLI with the current Node binary
 *
 * @param {string} cwd - Project directory
 * @param {string} pkgName - Package name, e.g. 'vite'
 * @param {string[]} args - Arguments for the CLI
 * @param {Object} options - node:child_process spawn options
 * @returns {import('node:child_process').ChildProcess}
 * @throws {Error} If the package is not installed in the project
 */
export function spawnBin(cwd: string, pkgName: string, args: string[], options?: any): import("node:child_process").ChildProcess;
/**
 * Spawn npm
 *
 * npm itself lives outside node_modules, so it needs a shell on Windows.
 * The command is built as one string because passing an args array alongside
 * `shell: true` is deprecated (DEP0190) — safe here since every argument is a
 * fixed literal, never user input.
 *
 * @param {string[]} args - npm arguments, e.g. ['install']
 * @param {Object} options - node:child_process spawn options
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnNpm(args: string[], options?: any): import("node:child_process").ChildProcess;
