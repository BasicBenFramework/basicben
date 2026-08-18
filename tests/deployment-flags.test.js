/**
 * DISABLE_REGISTRATION and DISABLE_PUBLIC_SITE, checked against the source that
 * implements them.
 *
 * These are deployment switches, so the failure that matters is the quiet one:
 * a flag that hides a form while the endpoint behind it still accepts requests,
 * or a client that drops a route the server still advertises in a sitemap. Both
 * halves are asserted here.
 *
 * The client half is a build-time constant, so it cannot be exercised by
 * calling anything — it is checked by reading the source, which is weaker than
 * a runtime test and stronger than nothing. The server half is real logic and
 * is tested as such.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf-8')

describe('the flags reach both halves of the app', () => {
  test('one environment variable each, not one per side', () => {
    const vite = read('vite.config.ts')

    // Two names for one switch is how a site ends up hiding registration in
    // the UI while still accepting it over the API.
    assert.match(vite, /__DISABLE_REGISTRATION__:\s*JSON\.stringify\(process\.env\.DISABLE_REGISTRATION === 'true'\)/)
    assert.match(vite, /__DISABLE_PUBLIC_SITE__:\s*JSON\.stringify\(process\.env\.DISABLE_PUBLIC_SITE === 'true'\)/)
  })

  test('both are declared for TypeScript', () => {
    const types = read('vite-env.d.ts')

    assert.match(types, /declare const __DISABLE_REGISTRATION__: boolean/)
    assert.match(types, /declare const __DISABLE_PUBLIC_SITE__: boolean/)
  })

  test('both are documented, commented out so the default is the full app', () => {
    const env = read('.env.example')

    assert.match(env, /^# DISABLE_REGISTRATION=true$/m)
    assert.match(env, /^# DISABLE_PUBLIC_SITE=true$/m)
  })
})

describe('DISABLE_REGISTRATION', () => {
  const controller = read('src/controllers/AuthController.ts')

  test('is enforced in the controller, not only in the router', () => {
    // A route the UI does not link to is still a route, and a middleware
    // guard on the router would not know whether this is the first account.
    assert.match(controller, /process\.env\.DISABLE_REGISTRATION === 'true'/)
    assert.match(controller, /Registration is closed/)
  })

  test('refuses with 403 rather than pretending the route is missing', () => {
    // 404 would be a lie an operator has to debug; 403 says the door is shut
    // deliberately.
    assert.match(controller, /Registration is closed'\s*\},\s*403/)
  })

  test('does not apply when no account exists yet', () => {
    // Otherwise a fresh deployment with the flag already set can never create
    // its own admin, and the flag locks the operator out of their own install.
    const guard = controller.match(/if \(!isFirstUser && process\.env\.DISABLE_REGISTRATION[^)]*\)/)

    assert.ok(guard, 'the guard must exempt the first account')
  })

  test('refuses before looking the address up', () => {
    // Order is the point. Checking for a duplicate first would answer a
    // question the caller has no business asking: a taken address comes back
    // "already registered" while a free one comes back "closed", which turns
    // an endpoint that refuses everyone into a way to test which addresses
    // have accounts.
    const closed = controller.indexOf('Registration is closed')
    const lookup = controller.indexOf('User.findByEmail(email)')

    assert.ok(closed !== -1 && lookup !== -1)
    assert.ok(
      closed < lookup,
      'a closed registration must not double as an account-existence oracle'
    )
  })

  test('the client drops the route rather than hiding the form', () => {
    const app = read('src/routes/App.tsx')

    assert.match(app, /__DISABLE_REGISTRATION__/)
    assert.match(app, /'\/login': \{ component: Auth/, 'signing in must stay reachable')
  })

  test('nothing links to a route that will not exist', () => {
    for (const file of [
      'src/client/components/Nav/DesktopNav.tsx',
      'src/client/components/Nav/MobileNav.tsx',
      'src/client/pages/Auth.tsx'
    ]) {
      const source = read(file)

      if (!source.includes("'/register'")) continue

      assert.match(
        source,
        /!__DISABLE_REGISTRATION__/,
        `${file} links to /register without guarding it`
      )
    }
  })
})

describe('DISABLE_PUBLIC_SITE', () => {
  test('the feed and sitemap are not registered at all', () => {
    const routes = read('src/routes/api/feed.ts')

    // Registering them and returning 404 from the controller would still
    // advertise them in a HEAD request and still cost a database call.
    assert.match(routes, /process\.env\.DISABLE_PUBLIC_SITE === 'true'\) return/)
  })

  test('the content API is untouched by it', () => {
    const v1 = read('src/routes/api/v1.ts')

    // Serving a headless consumer is the entire reason to run in this mode.
    assert.doesNotMatch(v1, /DISABLE_PUBLIC_SITE/)
  })

  test('the public pages come out of the bundle', () => {
    const app = read('src/routes/App.tsx')

    assert.match(app, /const publicRoutes[^=]*= __DISABLE_PUBLIC_SITE__/)

    for (const route of ["'/feed'", "'/docs'", "'/feed/:id'"]) {
      assert.ok(app.includes(route), `${route} should still be defined, inside the guard`)
    }
  })

  test('the root path still resolves, so the domain is not a dead end', () => {
    const app = read('src/routes/App.tsx')

    assert.match(
      app,
      /__DISABLE_PUBLIC_SITE__ \? \{ '\/': \{ component: Auth/,
      'with no public site, / should reach sign-in rather than 404'
    )
  })

  test('the nav does not point at pages that were removed', () => {
    for (const file of [
      'src/client/components/Nav/DesktopNav.tsx',
      'src/client/components/Nav/MobileNav.tsx'
    ]) {
      const source = read(file)

      for (const dead of ["'/docs'", "'/feed'"]) {
        if (!source.includes(dead)) continue

        assert.match(
          source,
          /!__DISABLE_PUBLIC_SITE__/,
          `${file} links to ${dead} without guarding it`
        )
      }
    }
  })
})
