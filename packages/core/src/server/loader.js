/**
 * Auto-loaders for routes and middleware.
 * Scans directories and loads files automatically.
 */

import { readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Router } from './router.js'
import { isModuleFile } from '../modules.js'

/**
 * Load all route files from a directory.
 * Each file should export a default function that receives the router.
 *
 * @param {string} dir - Directory to scan (default: src/routes)
 * @returns {Router} - Router with all routes loaded
 */
export async function loadRoutes(dir = 'src/routes') {
  const router = new Router()
  const routesDir = resolve(process.cwd(), dir)

  if (!existsSync(routesDir)) {
    return router
  }

  const files = getJsFiles(routesDir)

  for (const file of files) {
    try {
      const fileUrl = pathToFileURL(file).href
      const module = await import(fileUrl)

      if (typeof module.default === 'function') {
        module.default(router)
      }
    } catch (err) {
      console.error(`Error loading route file: ${file}`)
      console.error(err.message)
    }
  }

  return router
}

/**
 * Load all middleware files from a directory.
 * Files are loaded in alphabetical order.
 * Each file should export a default middleware function.
 *
 * @param {string} dir - Directory to scan (default: src/middleware)
 * @returns {Function[]} - Array of middleware functions
 */
export async function loadMiddleware(dir = 'src/middleware') {
  const middleware = []
  const middlewareDir = resolve(process.cwd(), dir)

  if (!existsSync(middlewareDir)) {
    return middleware
  }

  const files = getJsFiles(middlewareDir).sort()

  for (const file of files) {
    try {
      const fileUrl = pathToFileURL(file).href
      const module = await import(fileUrl)

      if (typeof module.default === 'function') {
        middleware.push(module.default)
      }
    } catch (err) {
      console.error(`Error loading middleware file: ${file}`)
      console.error(err.message)
    }
  }

  return middleware
}

/**
 * Get all .js files in a directory (recursive)
 */
function getJsFiles(dir, files = []) {
  const entries = readdirSync(dir)

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      getJsFiles(fullPath, files)
    } else if (isModuleFile(entry)) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Load config file if it exists
 *
 * @returns {Object} - Config object or empty defaults
 */
export async function loadConfig() {
  const configPaths = [
    'basicben.config.js',
    'basicben.config.mjs'
  ]

  for (const configPath of configPaths) {
    const fullPath = resolve(process.cwd(), configPath)

    if (existsSync(fullPath)) {
      try {
        const fileUrl = pathToFileURL(fullPath).href
        const module = await import(fileUrl)
        return module.default || {}
      } catch (err) {
        console.error(`\x1b[31mError loading config:\x1b[0m ${configPath}`)
        console.error(`  ${err.message}`)
        console.error(`\x1b[2mCheck your config file syntax.\x1b[0m\n`)
      }
    }
  }

  return {}
}
