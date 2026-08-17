/**
 * Tests for the plugin loader's two registration styles.
 *
 * The explicit list exists so plugins survive a bundled deployment, where a
 * directory scan finds nothing because the working tree was never shipped.
 * These cover the interaction between the two — which is where the surprises
 * are — rather than the scan on its own.
 */

import { test, describe, beforeEach, after } from 'node:test'
import assert from 'node:assert'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadPlugins } from './loader.js'
import { plugins } from './index.js'
import { hooks } from '../hooks/index.js'

const TEST_PLUGINS_DIR = resolve('./test-plugins')

/** A plugin config that records activation order in a shared array. */
function spyPlugin(name, log) {
  return {
    name,
    version: '1.0.0',
    description: `${name} test plugin`,
    initialize: () => {
      log.push(name)
    }
  }
}

describe('loadPlugins', () => {
  beforeEach(async () => {
    // The manager is a module singleton, so state leaks between tests unless
    // every plugin is deactivated and unregistered.
    await plugins.deactivateAll()
    for (const { name } of plugins.list()) {
      await plugins.unregister(name)
    }

    rmSync(TEST_PLUGINS_DIR, { recursive: true, force: true })
    mkdirSync(TEST_PLUGINS_DIR, { recursive: true })
  })

  after(() => {
    rmSync(TEST_PLUGINS_DIR, { recursive: true, force: true })
  })

  test('registers and activates explicitly passed plugins', async () => {
    const log = []

    const result = await loadPlugins(false, {
      modules: [spyPlugin('alpha', log), spyPlugin('beta', log)],
      enabled: ['alpha']
    })

    assert.deepStrictEqual(result.loaded, ['alpha', 'beta'])
    assert.deepStrictEqual(result.activated, ['alpha'])
    assert.deepStrictEqual(result.errors, [])

    // Only the enabled one initializes; the other is registered and inert.
    assert.deepStrictEqual(log, ['alpha'])
    assert.strictEqual(plugins.isActive('alpha'), true)
    assert.strictEqual(plugins.isActive('beta'), false)
  })

  test('dir: false touches no filesystem', async () => {
    writeFileSync(
      join(TEST_PLUGINS_DIR, 'on-disk.js'),
      `export default { name: 'on-disk', version: '1.0.0' }`
    )

    const result = await loadPlugins(false, { modules: [spyPlugin('alpha', [])] })

    assert.deepStrictEqual(result.loaded, ['alpha'])
    assert.strictEqual(plugins.get('on-disk'), undefined)
  })

  test('loads explicit and directory plugins together', async () => {
    writeFileSync(
      join(TEST_PLUGINS_DIR, 'scanned.js'),
      `export default { name: 'scanned', version: '2.0.0' }`
    )

    const result = await loadPlugins(TEST_PLUGINS_DIR, {
      modules: [spyPlugin('explicit', [])]
    })

    assert.deepStrictEqual(result.loaded.sort(), ['explicit', 'scanned'])
  })

  test('an explicit plugin is not registered twice by the scan', async () => {
    // The realistic case: the file is imported *and* still sitting in plugins/.
    writeFileSync(
      join(TEST_PLUGINS_DIR, 'hello.js'),
      `export default { name: 'hello', version: '9.9.9' }`
    )

    const result = await loadPlugins(TEST_PLUGINS_DIR, {
      modules: [{ name: 'hello', version: '1.0.0' }]
    })

    assert.deepStrictEqual(result.loaded, ['hello'])
    // The explicit one wins, so the version is the imported object's.
    assert.strictEqual(plugins.get('hello').version, '1.0.0')
  })

  test('records where each plugin came from', async () => {
    // The name lives in the config object, not the filename, so a plugin whose
    // file is named differently must still be reported as scanned.
    writeFileSync(
      join(TEST_PLUGINS_DIR, 'seo.js'),
      `export default { name: 'seo-toolkit', version: '1.0.0' }`
    )

    await loadPlugins(TEST_PLUGINS_DIR, {
      modules: [{ name: 'from-config', version: '1.0.0' }]
    })

    const byName = Object.fromEntries(plugins.list().map((p) => [p.name, p.source]))

    assert.strictEqual(byName['from-config'], 'config')
    assert.strictEqual(byName['seo-toolkit'], 'directory')
  })

  test('unwraps a module namespace object', async () => {
    const result = await loadPlugins(false, {
      modules: [{ default: { name: 'namespaced', version: '1.0.0' } }]
    })

    assert.deepStrictEqual(result.loaded, ['namespaced'])
  })

  test('records a bad entry instead of throwing', async () => {
    const result = await loadPlugins(false, {
      modules: [null, { name: 'good', version: '1.0.0' }]
    })

    assert.deepStrictEqual(result.loaded, ['good'])
    assert.strictEqual(result.errors.length, 1)
    assert.match(result.errors[0].error, /Expected a plugin object/)
  })

  test('a failing initialize does not stop later plugins', async () => {
    const log = []

    const result = await loadPlugins(false, {
      modules: [
        {
          name: 'broken',
          version: '1.0.0',
          initialize: () => {
            throw new Error('boom')
          }
        },
        spyPlugin('healthy', log)
      ],
      enabled: ['broken', 'healthy']
    })

    assert.deepStrictEqual(result.activated, ['healthy'])
    assert.deepStrictEqual(log, ['healthy'])
    assert.strictEqual(result.errors.length, 1)
    assert.match(result.errors[0].error, /boom/)

    // The failed activation must not leave hooks bound behind it.
    assert.strictEqual(plugins.isActive('broken'), false)
  })

  test('binds hooks from an explicitly passed plugin', async () => {
    const seen = []

    await loadPlugins(false, {
      modules: [
        {
          name: 'hooked',
          version: '1.0.0',
          hooks: {
            'test.explicit': (payload) => seen.push(payload)
          }
        }
      ],
      enabled: ['hooked']
    })

    await hooks.fire('test.explicit', { ok: true })

    assert.deepStrictEqual(seen, [{ ok: true }])
  })
})
