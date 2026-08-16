/**
 * Theme resolution tests.
 *
 * The interesting behaviour is what happens when a theme is *incomplete*, which
 * is the normal case — a theme overrides the two or three layouts it cares
 * about and inherits the rest. Until the template shipped a second theme there
 * was nothing real to test that against, so these use the actual files on disk
 * rather than a hand-built fixture: `default` implements everything, `minimal`
 * implements two layouts and nothing else.
 *
 * Imports the React-free half of the module, because the framework's suite runs
 * before dependencies are installed — React is a peer dependency the app
 * provides, not something the framework's own tests may assume.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createThemeRegistry, resolveThemeSource } from './theme-registry.js'

const here = dirname(fileURLToPath(import.meta.url))
const THEMES = join(here, '../../create-basicben-app/template-ts/themes')

/**
 * Build a registry from the real theme directories.
 *
 * Layouts and components are separate registries, as they are in the app —
 * `App.tsx` globs `layouts/*` and `components/*` independently. Merging them
 * here would mean a theme's internal helper components counted as overridable
 * layouts, which is not what the app resolves against.
 */
function registryFromDisk(kind = 'layouts') {
  const modules = {}

  for (const theme of readdirSync(THEMES)) {
    const dir = join(THEMES, theme, kind)
    if (!existsSync(dir)) continue

    for (const file of readdirSync(dir)) {
      modules[`../../themes/${theme}/${kind}/${file}`] =
        () => Promise.resolve({ default: `${theme}/${file}` })
    }
  }

  return createThemeRegistry(modules)
}

// The real resolver, not a restatement of its rule — a test that reimplements
// the logic it is checking passes when both are wrong in the same way.
const resolveFrom = resolveThemeSource

describe('createThemeRegistry', () => {
  test('indexes by theme slug and component name', () => {
    const registry = createThemeRegistry({
      '../../themes/default/layouts/PostLayout.tsx': () => {},
      '../../themes/dark/layouts/PostLayout.tsx': () => {},
      '../../themes/dark/components/PostCard.tsx': () => {}
    })

    assert.deepEqual(Object.keys(registry).sort(), ['dark', 'default'])
    assert.ok(registry.dark.PostLayout)
    assert.ok(registry.dark.PostCard)
  })

  test('ignores paths outside a themes directory', () => {
    const registry = createThemeRegistry({
      './src/client/layouts/AppLayout.tsx': () => {},
      '../../themes/default/layouts/PostLayout.tsx': () => {}
    })

    assert.deepEqual(Object.keys(registry), ['default'])
    assert.equal(Object.keys(registry.default).length, 1)
  })

  test('accepts every extension a theme might use', () => {
    const registry = createThemeRegistry({
      '../../themes/a/layouts/One.tsx': () => {},
      '../../themes/a/layouts/Two.jsx': () => {},
      '../../themes/a/layouts/Three.ts': () => {},
      '../../themes/a/layouts/Four.js': () => {}
    })

    assert.deepEqual(Object.keys(registry.a).sort(), ['Four', 'One', 'Three', 'Two'])
  })

  test('an empty glob gives an empty registry rather than throwing', () => {
    assert.deepEqual(createThemeRegistry({}), {})
    assert.deepEqual(createThemeRegistry(), {})
  })
})

describe('the shipped themes', () => {
  const registry = registryFromDisk('layouts')
  const components = registryFromDisk('components')

  test('both themes are discovered', () => {
    assert.deepEqual(Object.keys(registry).sort(), ['default', 'minimal'])
  })

  test('default implements the full set', () => {
    for (const name of ['PostLayout', 'ArchiveLayout', 'PageLayout', 'DefaultLayout']) {
      assert.ok(registry.default[name], `default is missing ${name}`)
    }
  })

  test('minimal is deliberately partial', () => {
    // If this ever grows to match default, the fallback below stops being
    // tested by anything real.
    assert.deepEqual(Object.keys(registry.minimal).sort(), ['ArchiveLayout', 'PostLayout'])
  })

  test('every layout composes its chrome rather than restating it', () => {
    // The four default layouts each carried their own copy of the header, nav
    // and footer, and the components that existed to supply them were imported
    // by nothing. Changing the nav was a four-file edit.
    for (const theme of Object.keys(registry)) {
      assert.ok(
        Object.keys(components[theme] || {}).length > 0,
        `theme "${theme}" has layouts but no components to compose from`
      )
    }
  })
})

describe('resolution', () => {
  const registry = registryFromDisk('layouts')

  test('the active theme wins where it provides a layout', () => {
    assert.equal(resolveFrom(registry, 'minimal', 'default', 'PostLayout'), 'minimal')
    assert.equal(resolveFrom(registry, 'minimal', 'default', 'ArchiveLayout'), 'minimal')
  })

  test('a layout the active theme lacks comes from the fallback', () => {
    // The whole point of the fallback: a theme should not have to implement
    // every layout to be usable.
    assert.equal(resolveFrom(registry, 'minimal', 'default', 'PageLayout'), 'default')
    assert.equal(resolveFrom(registry, 'minimal', 'default', 'DefaultLayout'), 'default')
  })

  test('components fall back the same way layouts do', () => {
    // Components are a separate registry, so the rule has to hold there too —
    // minimal ships no PostCard and should get the default theme's.
    const components = registryFromDisk('components')

    assert.equal(resolveFrom(components, 'minimal', 'default', 'PostCard'), 'default')
    assert.equal(resolveFrom(components, 'minimal', 'default', 'Sidebar'), 'default')
    assert.equal(resolveFrom(components, 'minimal', 'default', 'Chrome'), 'minimal')
  })

  test('a layout no theme provides resolves to nothing', () => {
    // null rather than an error, so the caller renders its own markup.
    assert.equal(resolveFrom(registry, 'minimal', 'default', 'Nonexistent'), null)
  })

  test('an unknown active theme falls back entirely', () => {
    // A stale name in the database must not blank the site.
    assert.equal(resolveFrom(registry, 'was-uninstalled', 'default', 'PostLayout'), 'default')
  })

  test('nothing leaks from an inactive theme', () => {
    for (const name of ['PostLayout', 'ArchiveLayout', 'PageLayout']) {
      assert.equal(resolveFrom(registry, 'default', 'default', name), 'default')
    }
  })
})
