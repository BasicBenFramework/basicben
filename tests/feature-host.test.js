/**
 * Phase 4a: features as folders behind the host.
 *
 * The promise is that a feature can be left off — or deleted, its folder and
 * its key in each of the three maps — and the core still builds and runs. That holds
 * only while core never reaches into a feature and features never reach into
 * each other, so both are checked here on every import in src/.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCron, cronAuthorized } from '../src/host/cron.ts'
import { registerFeatures, cronTaskList, featureHealthChecks, registeredFeatures } from '../src/host/index.ts'
import { isKnownSetting, checks } from '../src/helpers/site-settings.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const FEATURES = join(SRC, 'features')
const LISTS = ['src/features.ts', 'src/client/features.ts', 'src/features.manifest.ts']
const CORE = join(ROOT, 'node_modules/@basicbenframework/core/src/db')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(tsx?|jsx?|mjs)$/.test(entry)) out.push(path)
  }
  return out
}

/** Every relative module specifier in a file, static or dynamic, resolved to a path. */
function importsOf(file) {
  const source = readFileSync(file, 'utf-8')
  const specs = [
    ...source.matchAll(/\b(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)
  ].map((m) => m[1])
  return specs.filter((s) => s.startsWith('.')).map((s) => resolve(dirname(file), s))
}

const featureOf = (path) => {
  const rel = relative(FEATURES, path)
  return rel.startsWith('..') ? null : rel.split(sep)[0]
}

const rel = (path) => relative(ROOT, path)

describe('the feature boundary', () => {
  test('core imports a feature only through the three maps', () => {
    const offenders = []
    for (const file of walk(SRC).filter((f) => !featureOf(f))) {
      if (LISTS.includes(rel(file))) continue
      for (const target of importsOf(file)) {
        if (featureOf(target)) offenders.push(`${rel(file)} → ${rel(target)}`)
      }
    }
    assert.deepStrictEqual(offenders, [], 'core would break when this feature is removed')
  })

  test('the maps import only a feature\'s entry points', () => {
    const allowed = { 'src/features.ts': /^index(\.ts)?$/, 'src/client/features.ts': /^admin(\.tsx?)?$/, 'src/features.manifest.ts': /^manifest(\.ts)?$/ }
    for (const list of LISTS) {
      for (const target of importsOf(join(ROOT, list))) {
        if (!featureOf(target)) continue
        const inside = relative(join(FEATURES, featureOf(target)), target)
        assert.match(inside, allowed[list], `${list} imports ${rel(target)}`)
      }
    }
  })

  test('features do not import each other', () => {
    const offenders = []
    for (const file of walk(FEATURES)) {
      for (const target of importsOf(file)) {
        const other = featureOf(target)
        if (other && other !== featureOf(file)) offenders.push(`${rel(file)} → ${rel(target)}`)
      }
    }
    assert.deepStrictEqual(offenders, [])
  })

  test('a manifest is data: it imports nothing at runtime', () => {
    // The export and backup scripts load manifests with plain Node and no
    // database; a runtime import would drag the feature's code in with them.
    for (const feature of readdirSync(FEATURES)) {
      const path = join(FEATURES, feature, 'manifest.ts')
      if (!existsSync(path)) continue
      const runtime = [...readFileSync(path, 'utf-8').matchAll(/^import\s+(?!type\b).*$/gm)].map((m) => m[0])
      assert.deepStrictEqual(runtime, [], `${rel(path)} has a runtime import`)
    }
  })

  test('the three maps name the same features, each under its own folder', () => {
    const named = LISTS.map((list) => {
      const source = readFileSync(join(ROOT, list), 'utf-8')
      return [...source.matchAll(/['"]\.{1,2}\/(?:\.\.\/)?features\/([\w-]+)\//g)].map((m) => m[1]).sort()
    })
    const folders = readdirSync(FEATURES).filter((e) => statSync(join(FEATURES, e)).isDirectory()).sort()
    assert.deepStrictEqual(named[0], folders, 'src/features.ts does not import every feature folder')
    assert.deepStrictEqual(named[1], named[0], 'src/client/features.ts differs from src/features.ts')
    assert.deepStrictEqual(named[2], named[0], 'src/features.manifest.ts differs from src/features.ts')
  })

  test('each map keys a feature by its own name', async () => {
    const maps = [
      (await import('../src/features.ts')).default,
      (await import('../src/features.manifest.ts')).default
    ]
    for (const map of maps) {
      for (const [key, value] of Object.entries(map)) assert.strictEqual(value.name, key)
    }
    const admin = (await import('../src/client/features.ts')).default
    assert.deepStrictEqual(Object.keys(admin).sort(), Object.keys(maps[0]).sort())
  })

  test('every feature folder has a server entry and a manifest', () => {
    for (const feature of readdirSync(FEATURES).filter((e) => statSync(join(FEATURES, e)).isDirectory())) {
      assert.ok(existsSync(join(FEATURES, feature, 'index.ts')), `${feature}/index.ts`)
      assert.ok(existsSync(join(FEATURES, feature, 'manifest.ts')), `${feature}/manifest.ts`)
    }
  })
})

describe('a site\'s features list', () => {
  test('importing every feature does nothing until one is registered', async () => {
    // The server imports the whole map and registers only what the site lists,
    // so a feature's module must not act on import: no listeners, no settings,
    // no tasks, no routes.
    const { hooks } = await import('@basicbenframework/core/hooks')
    const before = { hooks: JSON.stringify(hooks.list().map((h) => [h, hooks.count(h)])), tasks: cronTaskList().length }
    await import('../src/features.ts')
    assert.strictEqual(JSON.stringify(hooks.list().map((h) => [h, hooks.count(h)])), before.hooks)
    assert.strictEqual(cronTaskList().length, before.tasks)
    for (const key of ['analytics_enabled', 'members_signup', 'mysendbox_audience_id', 'public_theme']) {
      assert.strictEqual(isKnownSetting(key), false, `${key} is defined without its feature registered`)
    }
  })

  test('names are checked against the features the CMS has', async () => {
    const { enabledFeatureNames } = await import('../src/host/enabled.ts')
    assert.deepStrictEqual(enabledFeatureNames([]), [])
    assert.deepStrictEqual(enabledFeatureNames(['analytics', 'theme']), ['analytics', 'theme'])
    assert.throws(() => enabledFeatureNames(['analytcs']), /Unknown feature "analytcs".*analytics, members, mysendbox, theme/)
    assert.throws(() => enabledFeatureNames(['members', 'members']), /listed twice/)
    assert.throws(() => enabledFeatureNames('members'), /must be a list/)
    assert.throws(() => enabledFeatureNames(['toString']), /Unknown feature/)
  })

  test('no list means the bare core, with a warning', async () => {
    const { enabledFeatureNames } = await import('../src/host/enabled.ts')
    const warn = console.warn
    const said = []
    console.warn = (message) => said.push(message)
    try {
      assert.deepStrictEqual(enabledFeatureNames(undefined), [])
    } finally {
      console.warn = warn
    }
    assert.match(said.join(''), /No `features`/)
  })
})

describe('registering features', () => {
  test('a feature\'s tasks and checks are namespaced; a second copy is refused', async () => {
    const feature = {
      name: 'demo',
      register(host) {
        host.settings.define({ demo_flag: { group: 'demo', check: checks.flag } })
        host.cron.task('sweep', 60, async () => 'swept')
        host.health.check('ok', async () => null)
      }
    }
    await registerFeatures([feature])
    assert.ok(registeredFeatures().includes('demo'))
    assert.ok(cronTaskList().some((t) => t.name === 'demo:sweep'))
    assert.ok(featureHealthChecks().some((c) => c.name === 'demo:ok'))
    assert.ok(isKnownSetting('demo_flag'))

    await assert.rejects(registerFeatures([feature]), /listed twice/)
  })

  test('a setting core already owns cannot be redefined', async () => {
    await assert.rejects(
      registerFeatures([{ name: 'thief', register: (host) => host.settings.define({ site_name: { group: 'x', check: checks.flag } }) }]),
      /already defined/
    )
  })
})

describe('the cron tick', () => {
  async function freshDb() {
    const { createSqliteAdapter } = await import(join(CORE, 'adapters/sqlite.js'))
    const { createMigrator } = await import(join(CORE, 'migrator.js'))
    const db = await createSqliteAdapter(':memory:', { wal: false })
    await (await createMigrator(join(ROOT, 'db/migrations'), db)).migrate()
    return db
  }

  test('runs what is due, records it, and skips it until its interval passes', async () => {
    const db = await freshDb()
    let clock = Date.parse('2026-11-23T12:00:00Z')
    const now = () => clock
    const runs = []
    const tasks = [
      { name: 'fast', everySeconds: 60, run: async () => { runs.push('fast'); return 1 } },
      { name: 'slow', everySeconds: 3600, run: async () => { runs.push('slow') } }
    ]

    const first = await runCron({ db, now, tasks })
    assert.deepStrictEqual(first.ran, { fast: 1, slow: true })
    const beat = await db.get("SELECT last_run_at FROM ops_heartbeats WHERE name = 'cron:fast'")
    assert.ok(beat, 'no heartbeat for the task')

    clock += 90_000
    const second = await runCron({ db, now, tasks })
    assert.deepStrictEqual(Object.keys(second.ran), ['fast'])
    assert.deepStrictEqual(runs, ['fast', 'slow', 'fast'])
  })

  test('a failing task is reported, does not stop the others, and waits its interval', async () => {
    const db = await freshDb()
    let clock = Date.parse('2026-11-23T12:00:00Z')
    let calls = 0
    const tasks = [
      { name: 'broken', everySeconds: 60, run: async () => { calls++; throw new Error('nope') } },
      { name: 'fine', everySeconds: 60, run: async () => 'ok' }
    ]
    const result = await runCron({ db, now: () => clock, tasks })
    assert.deepStrictEqual(result.failed, { broken: 'nope' })
    assert.strictEqual(result.ran.fine, 'ok')

    clock += 10_000
    await runCron({ db, now: () => clock, tasks })
    assert.strictEqual(calls, 1, 'a failing task retried on every tick')
  })

  test('the budget leaves the rest for the next tick; `only` runs a task whether due or not', async () => {
    const db = await freshDb()
    let clock = 0
    const tasks = [
      { name: 'long', everySeconds: 60, run: async () => { clock += 30_000 } },
      { name: 'next', everySeconds: 60, run: async () => {} }
    ]
    const result = await runCron({ db, now: () => clock, tasks, budgetMs: 25_000 })
    assert.deepStrictEqual(result.skipped, ['next'])

    const forced = await runCron({ db, now: () => clock, tasks, only: ['long'] })
    assert.deepStrictEqual(Object.keys(forced.ran), ['long'], 'only ran something else, or skipped a task run moments ago')
  })

  test('the routes need CRON_SECRET, and are disabled without one', () => {
    const saved = process.env.CRON_SECRET
    try {
      delete process.env.CRON_SECRET
      assert.strictEqual(cronAuthorized({ headers: { authorization: 'Bearer ' } }), false)
      process.env.CRON_SECRET = 's'.repeat(32)
      assert.strictEqual(cronAuthorized({ headers: {} }), false)
      assert.strictEqual(cronAuthorized({ headers: { authorization: 'Bearer wrong' } }), false)
      assert.strictEqual(cronAuthorized({ headers: { authorization: `Bearer ${'s'.repeat(32)}` } }), true)
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = saved
    }
  })

  test('core registers its own tasks through the same registry', () => {
    const source = readFileSync(join(SRC, 'host/core-tasks.ts'), 'utf-8')
    assert.match(source, /name: 'publish-due'/)
    assert.match(source, /name: 'rate-limit-sweep'/)
    assert.match(readFileSync(join(SRC, 'routes/api/cron.ts'), 'utf-8'), /'\/api\/cron\/tick', cronTickEndpoint/)
  })
})
