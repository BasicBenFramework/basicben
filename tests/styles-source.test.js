/**
 * The admin's stylesheet must name its own sources.
 *
 * Tailwind skips node_modules when it looks for class names. A site that
 * installs the CMS compiles lib/client/styles.css from inside node_modules, so
 * without an explicit @source the admin's classes never reach the CSS and it
 * renders unstyled (cms.ctmakes.com, CMS 0.7.1).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('styles.css points Tailwind at the CMS sources', () => {
  const css = readFileSync(join(ROOT, 'src/client/styles.css'), 'utf-8')
  assert.match(css, /^@source '\.\.\/';$/m)
})
