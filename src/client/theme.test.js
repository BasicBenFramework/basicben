/**
 * Theme resolution tests.
 *
 * The interesting behaviour is what happens when a theme is *incomplete*, which
 * is the normal case — a theme overrides the two or three layouts it cares
 * about and inherits the rest. Until the template shipped a second theme there
 * was nothing real to test that against, so these use the actual files on disk
 * rather than a hand-built fixture: `default` implements everything, `minimal`
 * implements two layouts and nothing else.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createThemeRegistry } from './theme.js'

const here = dirname(fileURLToPath(import.meta.url))
const THEMES = join(here, '../../create-basicben-app/template-ts/themes')

/** Build the registry from the real theme directories, as the app does. */
function registryFromDisk() {
  const modules = {}

  for (const theme of readdirSync(THEMES)) {
    for (const kind of ['layouts', 'components']) {
      const dir = join(THEMES, theme, kind)
      if (!existsSync(dir)) continue

      for (const file of readdirSync(dir)) {
        modules[`../../themes/${theme}/${kind}/${file}`] =
          () => Promise.resolve({ default: `${theme}/${file}` })
      }
    }
  }

  return createThemeRegistry(modules)
}

/** The resolver's rule: active theme, then fallback theme, then nothing. */
function resolveFrom(registry, active, fallback, name) {
  if (registry[active]?.[name]) return active
  if (registry[fallback]?.[name]) return fallback
  return null
}

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
  const registry = registryFromDisk()

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
})

describe('resolution', () => {
  const registry = registryFromDisk()

  test('the active theme wins where it provides a layout', () => {
    assert.equal(resolveFrom(registry, 'minimal', 'default', 'PostLayout'), 'minimal')
    assert.equal(resolveFrom(registry, 'minimal', 'default', 'ArchiveLayout'), 'minimal')
  })

  test('a layout the active theme lacks comes from the fallback', () => {
    // The whole point of the fallback: a theme should not have to implement
    // every layout to be usable.
    assert.equal(resolveFrom(registry, 'minimal', 'default', 'PageLayout'), 'default')
    assert.equal(resolveFrom(registry, 'minimal', 'default', 'DefaultLayout'), 'default')
    assert.equal(resolveFrom(registry, 'minimal', 'default', 'PostCard'), 'default')
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
