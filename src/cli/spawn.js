/**
 * Cross-platform process spawning helpers.
 *
 * On Windows `npx` and `npm` are .cmd shims, which node:child_process cannot
 * launch directly — the bare name fails with ENOENT and the .cmd name throws
 * EINVAL. Local CLIs are resolved from node_modules and run with the current
 * Node binary instead, which works everywhere and skips npx's startup cost.
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'

/**
 * Resolve a package's bin script from a project's node_modules
 *
 * @param {string} cwd - Project directory
 * @param {string} pkgName - Package name, e.g. 'vite'
 * @returns {string|null} Absolute path to the bin script, or null if not installed
 */
export function resolveBin(cwd, pkgName) {
  try {
    const require = createRequire(join(cwd, 'package.json'))
    const manifest = require.resolve(`${pkgName}/package.json`)
    const { bin } = require(manifest)
    const relative = typeof bin === 'string' ? bin : bin?.[pkgName]

    return relative ? join(dirname(manifest), relative) : null
  } catch {
    return null
  }
}

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
export function spawnBin(cwd, pkgName, args, options = {}) {
  const bin = resolveBin(cwd, pkgName)

  if (!bin) {
    throw new Error(
      `Cannot find ${pkgName} in this project. Run \`npm install\` first.`
    )
  }

  return spawn(process.execPath, [bin, ...args], { cwd, ...options })
}

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
export function spawnNpm(args, options = {}) {
  return spawn(['npm', ...args].join(' '), { ...options, shell: true })
}
