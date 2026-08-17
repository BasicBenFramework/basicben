/**
 * Database seeder.
 * Runs seed files to populate the database with initial/test data.
 */

import { readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getDb } from './index.js'
import { refuseLegacyLayout } from './layout.js'

/**
 * Create seeder instance
 *
 * @param {string} seedsDir - Path to seeds directory (default: 'db/seeds')
 */
export async function createSeeder(seedsDir = 'db/seeds') {
  const db = await getDb()
  const dir = resolve(process.cwd(), seedsDir)

  refuseLegacyLayout(dir, 'seeds', 'db/seeds')

  return {
    /**
     * Run all seed files
     *
     * @returns {Promise<{ ran: string[] }>}
     */
    async runAll() {
      const files = getSeedFiles(dir)

      if (files.length === 0) {
        return { ran: [], message: 'No seed files found.' }
      }

      const ran = []

      for (const seed of files) {
        await this.runSeed(seed.name, seed.path)
        ran.push(seed.name)
      }

      return { ran }
    },

    /**
     * Run a specific seed file
     *
     * @param {string} name - Seed file name (without extension)
     * @returns {Promise<void>}
     */
    async run(name) {
      const files = getSeedFiles(dir)
      const seed = files.find(f => f.name === name || f.name === `${name}.js`)

      if (!seed) {
        throw new Error(`Seed file not found: ${name}`)
      }

      await this.runSeed(seed.name, seed.path)
      return { ran: [seed.name] }
    },

    /**
     * Run a seed file by path
     *
     * @param {string} name - Seed name for logging
     * @param {string} filePath - Full path to seed file
     */
    async runSeed(name, filePath) {
      const module = await loadSeed(filePath)

      if (typeof module.seed !== 'function' && typeof module.default !== 'function') {
        throw new Error(
          `Seed file ${name} must export a 'seed' function or default function`
        )
      }

      const seedFn = module.seed || module.default

      try {
        await seedFn(db)
      } catch (err) {
        throw new Error(`Seed failed: ${name}\n${err.message}`)
      }
    },

    /**
     * List all available seed files
     *
     * @returns {string[]}
     */
    list() {
      return getSeedFiles(dir).map(f => f.name)
    }
  }
}

/**
 * Get list of seed files
 *
 * @param {string} dir - Seeds directory
 * @returns {{ name: string, path: string }[]}
 */
function getSeedFiles(dir) {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir)
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
    .sort()
    .map(f => ({
      name: f.replace('.js', ''),
      path: join(dir, f)
    }))
}

/**
 * Load seed module
 *
 * @param {string} filePath - Path to seed file
 */
async function loadSeed(filePath) {
  const fileUrl = pathToFileURL(filePath).href
  return import(fileUrl)
}
