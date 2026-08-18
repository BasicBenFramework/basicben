/**
 * Every declared hook must have a call site.
 *
 * A hook constant with nothing firing it is the worst kind of bug this project
 * has: someone reads `HOOKS.SERVER_STARTED`, writes a listener, and
 * nothing happens — no error, no warning, just silence. That exact hook was
 * declared and unfired for several versions, because `server.started` was only
 * raised from `app.start()` and nothing calls `app.start()`.
 *
 * The docs claim this check exists ("Every hook the framework declares fires —
 * that is checked by a test that walks the constants and looks for a call
 * site"). It did not, until this file. Every one passed on the day it was written;
 * the value is in the next hook someone adds.
 *
 * It reads the template's sources as well as the framework's, because the two
 * share `HOOKS` and the split is not the listener's problem: content and
 * CRUD hooks fire from the generated app's controllers, lifecycle and transport
 * hooks from the framework. A hook fired from either is a hook that fires.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOOKS } from './index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

const SOURCE_ROOTS = ['src', 'create-basicben-app/template-ts/src']

/** Every hook name, paired with the constant path that names it. */
function declaredHooks(obj = HOOKS, path = []) {
  const found = []

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') found.push({ name: value, constant: [...path, key].join('.') })
    else found.push(...declaredHooks(value, [...path, key]))
  }

  return found
}

/**
 * The file the hooks are declared in.
 *
 * It has to be excluded or the test passes vacuously: the declaration contains
 * every hook name as a string literal, so scanning it finds a "call site" for
 * every hook including one nothing fires. The first version of this test did
 * exactly that and reported all-green for a hook invented to break it.
 */
const DECLARATION = join(ROOT, 'src/hooks/index.js')

/** Application sources, excluding tests — a test firing a hook is not a call site. */
function sourceFiles(dir, found = []) {
  if (!existsSync(dir)) return found

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue

    const path = join(dir, entry.name)

    if (entry.isDirectory()) sourceFiles(path, found)
    else if (
      /\.(js|ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\./.test(entry.name) &&
      path !== DECLARATION
    ) {
      found.push(path)
    }
  }

  return found
}

describe('hook coverage', () => {
  const hooks = declaredHooks()
  const sources = SOURCE_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)))
  const blob = sources.map((file) => readFileSync(file, 'utf-8')).join('\n')

  test('the source roots were actually found', () => {
    // Guard against the whole test passing vacuously if the layout moves: an
    // empty blob would make every "has a call site" assertion fail loudly, but
    // a *partial* one would not, so assert the scan is plausible.
    assert.ok(sources.length > 50, `only scanned ${sources.length} files`)
    assert.ok(hooks.length > 0, 'no hooks declared')
  })

  test('the docs quote the right number of hooks', () => {
    // The Extending page states the count. Counts in prose go stale silently —
    // the entry-point list on the Testing page said nineteen for two releases
    // after it became eighteen — so the number is asserted rather than trusted.
    const page = join(ROOT, 'create-basicben-app/template-ts/src/client/pages/Extending.tsx')
    const quoted = readFileSync(page, 'utf-8').match(/All (\d+), by family/)

    assert.ok(quoted, 'the Extending docs page no longer states a hook count')
    assert.strictEqual(
      Number(quoted[1]),
      hooks.length,
      `docs say ${quoted[1]} hooks, HOOKS declares ${hooks.length}`
    )
  })

  for (const { name, constant } of hooks) {
    test(`${name} has a call site`, () => {
      const fired =
        blob.includes(`HOOKS.${constant}`) ||
        blob.includes(`'${name}'`) ||
        blob.includes(`"${name}"`)

      assert.ok(
        fired,
        `${name} is declared as HOOKS.${constant} but nothing fires it. ` +
          `A listener for it would never run, silently.`
      )
    })
  }
})
