/**
 * Where migrations and seeds live.
 *
 * They moved from `migrations/` and `seeds/` at the project root to
 * `db/migrations` and `db/seeds` in 0.3.0, matching the frameworks this one
 * borrows its conventions from.
 *
 * There is deliberately no fallback to the old location — one layout, not two.
 * But silence would be worse than either: both directory scanners treat a
 * missing directory as an empty one, so an app that had not moved its files
 * would run `basicben migrate`, be told "Nothing to migrate", and believe it.
 * A project still carrying the old layout is refused by name instead.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Refuse to run against a project that still uses the pre-0.3.0 layout.
 *
 * @param {string} dir - Absolute path that should hold the files
 * @param {string} legacy - Old project-relative directory ('migrations')
 * @param {string} current - New project-relative directory ('db/migrations')
 * @throws {Error} when the old directory exists and the new one does not
 */
export function refuseLegacyLayout(dir, legacy, current) {
  if (existsSync(dir)) return

  const legacyDir = resolve(process.cwd(), legacy)
  if (!existsSync(legacyDir)) return

  throw new Error(
    `Found ${legacy}/ but no ${current}/. These moved in 0.3.0 — ` +
      `run "mkdir -p db && git mv ${legacy} ${current}" (or "mv" outside git) and try again.`
  )
}
