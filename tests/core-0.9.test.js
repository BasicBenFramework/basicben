/**
 * What moving onto core 0.9 asks of the CMS.
 *
 * - Strict mass assignment: core refuses an insert or update that does not
 *   name its columns. The CMS's writes go through `insertRow` (a row the
 *   model built itself, whose keys are the allowlist) or name their columns
 *   with `only()` where outside data is spread in.
 * - Repeated query keys arrive as arrays. The CMS reads one value per key,
 *   so a `request.before` listener keeps the last one, as core 0.8 did.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'client' ? [] : sources(path)
    return /\.ts$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

test('every query-builder write names its columns', () => {
  const unguarded = []
  for (const file of sources(join(ROOT, 'src'))) {
    const code = readFileSync(file, 'utf-8')
    // A builder write is `.insert(` or `.update(` on something `query()`
    // returned. Each must have `.only(` in the same statement.
    for (const match of code.matchAll(/await query\([^)]*\)\)?[\s\S]{0,400}?\.(insert|update)\(/g)) {
      if (!/\.only\(/.test(match[0])) unguarded.push(`${relative(ROOT, file)}: ${match[0].split('\n')[0].trim()}`)
    }
    assert.ok(!/\.unguarded\(\)/.test(code), `${relative(ROOT, file)} opts out of the allowlist; name the columns`)
  }
  assert.deepStrictEqual(unguarded, [])
})

test('the spread writes name their columns rather than trusting the data', () => {
  const read = (path) => readFileSync(join(ROOT, path), 'utf-8')
  assert.match(read('src/models/User.ts'), /\.only\('name', 'email', 'password', 'role', 'slug'/)
  assert.match(read('src/models/Credential.ts'), /\.only\('user_id', 'credential_id', 'public_key'/)
  assert.match(read('src/models/Taxonomy.ts'), /\.only\('taxonomy_id', 'name', 'slug', 'description', 'parent_id'\)/)
})

test('insertRow allows exactly the keys of the row it is given', async () => {
  const { insertRow } = await import(pathToFileURL(join(ROOT, 'src/helpers/insert-row.ts')).href)
  assert.equal(typeof insertRow, 'function')
  assert.match(readFileSync(join(ROOT, 'src/helpers/insert-row.ts'), 'utf-8'), /\.only\(\.\.\.Object\.keys\(row\)\)\.insert\(row\)/)
})

test('a repeated query key reaches the CMS as its last value', async () => {
  await import(pathToFileURL(join(ROOT, 'src/hooks.ts')).href)
  const { hooks, HOOKS } = await import('@basicbenframework/core/hooks')
  const req = { query: { tag: ['a', 'b'], page: '2' } }
  const context = await hooks.filter(HOOKS.REQUEST_BEFORE, { req, res: {} })
  assert.deepStrictEqual(context.req.query, { tag: 'b', page: '2' })
})
