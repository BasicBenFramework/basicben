#!/usr/bin/env node
/**
 * Copy the CMS into this package so a published tarball is self-contained.
 *
 * The CMS is the repository this package sits inside — there is one copy of it
 * and it is the root. This runs on `prepack` so npm ships a snapshot, and
 * `index.js` prefers that snapshot when present. In a checkout the snapshot
 * does not exist and the root is read directly, so the two can never drift:
 * the snapshot is only ever produced at publish time.
 */
import { cpSync, rmSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '..')
const dest = join(here, 'template-ts')

if (!existsSync(source)) {
  console.error(`bundle-template: ${source} does not exist`)
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

// Build output and installed dependencies are reproduced by the scaffolded
// project, and node_modules would multiply the tarball by a hundred. `create`
// is skipped because the source is this package's own parent.
const skip = new Set([
  'node_modules', 'dist', '.env', 'database.sqlite',
  'create', '.git', '.github', 'package-lock.json'
])

// Entry by entry rather than one recursive copy of the root: `cpSync` refuses
// outright to copy a directory into its own subdirectory, and checks that
// before the filter ever runs, so filtering `create` out is not enough.
for (const entry of readdirSync(source)) {
  if (skip.has(entry)) continue

  cpSync(join(source, entry), join(dest, entry), {
    recursive: true,
    filter: (path) => !skip.has(path.split('/').pop())
  })
}

console.log(`bundle-template: copied the CMS -> ${dest}`)
