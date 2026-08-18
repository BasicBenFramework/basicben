/**
 * Nothing navigates to a route that does not exist.
 *
 * Signing out of the admin went to `/auth`, which has never been a route — the
 * routes are `/login` and `/register` — so logging out landed on a 404. Worse,
 * the framework's own `logout()` already navigates to `/`, so the handler was
 * navigating twice and the broken one won.
 *
 * That kind of mistake is invisible until someone clicks the thing: it type
 * checks, it builds, and the route table is in a different file from the call.
 * So the check is a comparison between the two.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

/**
 * The file with its comments removed.
 *
 * Without this the scan reads prose: the comment explaining that nothing should
 * navigate to '/auth' contains the string navigate('/auth'), so the test
 * reported the explanation as the offence.
 *
 * Only whole comment lines and block comments are stripped, never a trailing
 * `//` — that would cut a URL in half at `https://` and invent failures.
 */
function code(path) {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

function clientFiles(dir = 'src/client', found = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`

    if (entry.isDirectory()) clientFiles(path, found)
    else if (entry.name.endsWith('.tsx')) found.push(path)
  }

  return found
}

/** Every path the router defines, including the ones behind a build flag. */
function definedRoutes() {
  const app = code('src/routes/App.tsx')
  const routes = new Set()

  for (const [, path] of app.matchAll(/'(\/[a-z0-9/:_-]*)':\s*[{A-Z]/gi)) routes.add(path)

  return routes
}

/** Does `target` match a route, allowing for :params? */
function matches(target, routes) {
  if (routes.has(target)) return true

  const parts = target.split('/')

  for (const route of routes) {
    const routeParts = route.split('/')

    if (routeParts.length !== parts.length) continue

    const same = routeParts.every(
      (part, i) => part.startsWith(':') || part === parts[i]
    )

    if (same) return true
  }

  return false
}

describe('every internal navigation target exists', () => {
  const routes = definedRoutes()

  test('the route table was actually parsed', () => {
    // A regex that matched nothing would make every assertion below vacuous.
    assert.ok(routes.size > 10, `only found ${routes.size} routes`)
    assert.ok(routes.has('/login'), 'the login route should be among them')
    assert.ok(routes.has('/admin'), 'the admin route should be among them')
  })

  test('no navigate() goes somewhere undefined', () => {
    const broken = []

    for (const file of clientFiles()) {
      const source = code(file)

      for (const [, target] of source.matchAll(/navigate\('(\/[^']*)'\)/g)) {
        // Template paths built at runtime are checked by the ones they are
        // built from, not here.
        if (target.includes('$')) continue
        if (!matches(target, routes)) broken.push(`${file} -> ${target}`)
      }
    }

    assert.deepStrictEqual(broken, [], 'these navigate to routes that do not exist')
  })

  test('no Link points somewhere undefined', () => {
    const broken = []

    for (const file of clientFiles()) {
      const source = code(file)

      for (const [, target] of source.matchAll(/<Link\s+href="(\/[^"]*)"/g)) {
        if (target.includes('$')) continue
        if (!matches(target, routes)) broken.push(`${file} -> ${target}`)
      }
    }

    assert.deepStrictEqual(broken, [], 'these link to routes that do not exist')
  })
})

describe('signing out', () => {
  test('does not navigate on top of the framework, which already does', () => {
    // logout() clears the token and navigates to '/'. Following it with another
    // navigate is how this broke: the second one won and it pointed nowhere.
    const layout = code('src/client/layouts/AdminLayout.tsx')
    const handler = layout.match(/const handleLogout = \(\) => \{[\s\S]*?\n  \}/)

    assert.ok(handler, 'the logout handler should be findable')
    assert.doesNotMatch(
      handler[0],
      /navigate\(/,
      'logout() already navigates; a second navigate races it'
    )
  })
})
