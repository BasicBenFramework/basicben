#!/usr/bin/env node
/**
 * Copy apps/cms into this package so a published tarball is self-contained.
 *
 * The CMS is an application, not a folder inside this package — there is one
 * copy of it and it lives at apps/cms. This runs on `prepack` so npm ships a
 * snapshot of it, and `index.js` prefers that snapshot when present. In the
 * monorepo the snapshot does not exist and apps/cms is read directly, so the
 * two can never drift: the snapshot is only ever produced at publish time.
 */
import { cpSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../../apps/cms')
const dest = join(here, 'template-ts')

if (!existsSync(source)) {
  console.error(`bundle-template: ${source} does not exist`)
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })

// Build output and installed dependencies are reproduced by the scaffolded
// project, and node_modules would multiply the tarball by a hundred.
const skip = new Set(['node_modules', 'dist', '.env', 'database.sqlite'])

cpSync(source, dest, {
  recursive: true,
  filter: (path) => !skip.has(path.split('/').pop())
})

console.log(`bundle-template: copied apps/cms -> ${dest}`)
