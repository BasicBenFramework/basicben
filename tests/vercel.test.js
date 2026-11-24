/**
 * Files the Vercel function needs but no import leads to.
 *
 * Vercel ships a function with only the files its tracer can reach from
 * `api/index.js` by following imports. Three things the server reads from
 * disk are not reached that way:
 *
 * - `basicben.config.js`: core's loadConfig finds it with existsSync and
 *   imports a computed URL. Left out, it is simply absent, and the app runs
 *   on defaults with no CORS allowlist, no body-parser skip and console mail.
 *   Nothing errors.
 * - `mail/`: renderMail reads the templates from disk.
 * - `db/migrations/`: the health page lists them.
 *
 * So `vercel.json` names them in `includeFiles`. This test keeps the list and
 * the files in step.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf-8'))

test('the function carries the config, mail templates and migrations', () => {
  const include = vercel.functions?.['api/index.js']?.includeFiles
  assert.ok(include, 'vercel.json must set functions["api/index.js"].includeFiles')

  for (const [entry, path] of [
    ['basicben.config.js', 'basicben.config.js'],
    ['mail/**', 'mail'],
    ['db/migrations/**', 'db/migrations']
  ]) {
    assert.ok(include.includes(entry), `includeFiles must name ${entry}`)
    assert.ok(existsSync(join(ROOT, path)), `${path} must exist`)
  }
})

test('the function entry it names exists', () => {
  for (const name of Object.keys(vercel.functions ?? {})) {
    assert.ok(existsSync(join(ROOT, name)), `${name} must exist`)
  }
})
