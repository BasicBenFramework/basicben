/**
 * Read `.env` into the process environment.
 *
 * Every command needs this, not just the ones that start a server. `basicben
 * migrate` did not, so a project that set `DATABASE_URL` in `.env` — which is
 * what the generated `.env` tells you to do — migrated its SQLite default while
 * the server it then started read `.env` and connected to Postgres. Both
 * reported success, against different databases, and the app came up against an
 * empty schema.
 *
 * A value already in the environment wins. `.env` is a default, not an
 * override: that is what dotenv does, what Node's own `--env-file` does, and
 * what every host that injects configuration assumes. Overwriting meant
 * `DATABASE_URL=... basicben migrate` silently used the file's value instead.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * @param {string} [cwd] - directory to look for .env in
 * @returns {boolean} whether a file was found
 */
export function loadEnv(cwd = process.cwd()) {
  const envPath = resolve(cwd, '.env')

  if (!existsSync(envPath)) return false

  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) continue

    const [key, ...rest] = trimmed.split('=')

    if (!key || rest.length === 0) continue

    let value = rest.join('=').trim()

    // Strip an inline comment, but not one inside a quoted value.
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const comment = value.indexOf('#')
      if (comment !== -1) value = value.substring(0, comment).trim()
    }

    const name = key.trim()

    if (process.env[name] === undefined) {
      process.env[name] = value
    }
  }

  return true
}
