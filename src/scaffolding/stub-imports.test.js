/**
 * Generated files must import paths that actually resolve.
 *
 * Each stub's relative imports are written for the directory its command
 * targets, so the two have to stay in sync. make:route writes to
 * src/routes/api/, which puts the controllers directory two levels up — a stub
 * saying '../controllers/' resolves to src/routes/controllers/ and imports
 * nothing. loadRoutes catches that failure, logs it and moves on, so the only
 * symptom is routes quietly missing from the app. These tests run the real
 * commands into a temp project and resolve what they emit.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRoutes } from '../server/loader.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cli = resolve(__dirname, '../../bin/cli.js')

/**
 * Every make: command that writes a stub, with the argument to generate it.
 * Add new scaffolding commands here so their stub depth is covered too.
 */
const COMMANDS = [
  ['make:controller', 'post'],
  ['make:route', 'post'],
  ['make:model', 'post'],
  ['make:middleware', 'auth'],
  ['make:middleware', 'logger'],
  ['make:migration', 'create_posts'],
  ['make:seed', 'posts']
]

let project

before(() => {
  project = mkdtempSync(join(tmpdir(), 'basicben-scaffold-'))

  // A real generated app is ESM; don't lean on Node's syntax detection.
  writeFileSync(join(project, 'package.json'), JSON.stringify({ type: 'module' }))

  for (const [command, arg] of COMMANDS) {
    execFileSync(process.execPath, [cli, command, arg], { cwd: project, stdio: 'pipe' })
  }
})

after(() => {
  rmSync(project, { recursive: true, force: true })
})

/**
 * Strip comments so documentation examples aren't mistaken for real imports.
 * The middleware stubs deliberately show an import as it would appear in a
 * route file, which resolves from a different directory than the stub's own.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** Relative specifiers from real import/export statements. */
function relativeImports(source) {
  return [...stripComments(source).matchAll(/(?:^|[\s{}])(?:from|import)\s+'([^']+)'/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith('.'))
}

/** Every .js file the commands wrote into the project. */
function generatedFiles(dir = project) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return generatedFiles(full)
    return full.endsWith('.js') ? [full] : []
  })
}

describe('generated route imports', () => {
  test('imports the controller at a path that exists', () => {
    const routeFile = join(project, 'src/routes/api/post.js')
    assert.ok(existsSync(routeFile), 'make:route should write src/routes/api/post.js')

    const imports = relativeImports(readFileSync(routeFile, 'utf8'))

    // Guards the assertion below from passing vacuously if the stub changes.
    assert.strictEqual(imports.length, 1, 'route stub should import its controller')

    const resolved = resolve(dirname(routeFile), imports[0])
    assert.ok(
      existsSync(resolved),
      `route imports '${imports[0]}', which resolves to ${relative(project, resolved)} — no such file`
    )
    assert.strictEqual(resolved, join(project, 'src/controllers/PostController.js'))
  })

  test('loads through loadRoutes instead of being skipped', async () => {
    const errors = []
    const consoleError = console.error
    console.error = (...args) => errors.push(args.join(' '))

    let router
    try {
      router = await loadRoutes(join(project, 'src/routes'))
    } finally {
      console.error = consoleError
    }

    // loadRoutes swallows a bad import, so an empty router is the real symptom.
    assert.deepStrictEqual(errors, [], 'route file failed to import')
    assert.deepStrictEqual(
      router.routes.map((route) => `${route.method} ${route.path}`),
      [
        'GET /api/posts',
        'GET /api/posts/:id',
        'POST /api/posts',
        'PUT /api/posts/:id',
        'DELETE /api/posts/:id'
      ]
    )
  })
})

describe('every generated file', () => {
  test('has relative imports that all resolve', () => {
    const unresolved = []

    for (const file of generatedFiles()) {
      for (const specifier of relativeImports(readFileSync(file, 'utf8'))) {
        if (!existsSync(resolve(dirname(file), specifier))) {
          unresolved.push(`${relative(project, file)} imports '${specifier}'`)
        }
      }
    }

    assert.deepStrictEqual(unresolved, [])
  })
})
