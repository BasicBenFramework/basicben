#!/usr/bin/env node
/**
 * Import a Ghost export — Settings → Labs → Export your content (Ghost 4/5).
 *
 * Usage:
 *   node --env-file=.env scripts/import-ghost.mjs FILE.json [options]
 *
 *   --url URL                  the Ghost site's address, to resolve the
 *                              `__GHOST_URL__` placeholder in image URLs
 *   --dry-run                  report what would change, write nothing
 *   --update                   overwrite posts, pages, terms and media that
 *                              already exist (matched by slug / path)
 *   --no-primary-category      do not turn each post's primary tag into its
 *                              primary category as well
 *   --no-authors               attribute everything to the first admin
 *   --skip-media               do not create media rows
 *   --verbose                  print every row written
 *
 * Ghost has no comments in its export (they live with members), so none come
 * across. How tags, the primary tag, statuses, members-only posts and images
 * are mapped is described in scripts/lib/ghost.mjs and docs/import-export.md.
 */

import { readFile } from 'node:fs/promises'
import { getDb } from '@basicbenframework/core/db'
import { parseArgs } from './lib/import-common.mjs'
import { parseGhost } from './lib/ghost.mjs'
import { runSiteImport } from './lib/site-import.mjs'

async function main() {
  const { flags, options, positional } = parseArgs(process.argv.slice(2), {
    flags: ['dry-run', 'update', 'no-primary-category', 'no-authors', 'skip-media', 'verbose'],
    options: ['url']
  })

  const [file] = positional
  if (!file) throw new Error('Pass the export file: scripts/import-ghost.mjs ghost-export.json')

  const site = parseGhost(await readFile(file, 'utf-8'), {
    siteUrl: options.url ?? process.env.GHOST_URL,
    primaryTagAsCategory: !flags['no-primary-category']
  })
  const db = await getDb()

  console.log(`Importing ${file} (Ghost ${site.meta.version ?? 'unknown version'})`)
  console.log(
    `Found ${site.posts.filter((p) => p.type === 'post').length} post(s), ` +
      `${site.posts.filter((p) => p.type === 'page').length} page(s), ` +
      `${site.tags.length} tag(s), ${site.authors.length} author(s).`
  )

  await runSiteImport(db, site, flags)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`\nImport failed: ${error.message}`)
    process.exit(1)
  }
)
