#!/usr/bin/env node
/**
 * Import a WordPress export file (WXR) — Tools → Export → All content.
 *
 * Offline: the old site does not need to be running, reachable, or to have
 * its REST API open. The file also carries what the API hides from an
 * anonymous caller — drafts, scheduled and private posts, author addresses,
 * and every comment with its moderation state — so for a full move it is the
 * better source. `scripts/import-wordpress.mjs` remains for live sync from a
 * site that is still publishing.
 *
 * Usage:
 *   node --env-file=.env scripts/import-wxr.mjs FILE.xml [options]
 *
 *   --dry-run       report what would change, write nothing
 *   --update        overwrite posts, pages, terms and media that already
 *                   exist (matched by slug / path). Default: leave them be
 *   --no-authors    attribute everything to the first admin instead of
 *                   creating author accounts
 *   --no-comments   skip comments
 *   --skip-media    do not create media rows (featured images then unset)
 *   --verbose       print every row written
 *
 * What comes across, and how, is described in scripts/lib/wxr.mjs and
 * docs/import-export.md. In short: posts, pages (with hierarchy, menu order
 * and template), categories (with hierarchy), tags, threaded comments,
 * authors (as `author` accounts with no usable password), attachments as
 * media rows pointing at their existing paths, featured images, and Yoast
 * SEO fields. Files are not downloaded.
 */

import { readFile } from 'node:fs/promises'
import { getDb } from '@basicbenframework/core/db'
import { parseArgs } from './lib/import-common.mjs'
import { parseWxr } from './lib/wxr.mjs'
import { runSiteImport } from './lib/site-import.mjs'

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), {
    flags: ['dry-run', 'update', 'no-authors', 'no-comments', 'skip-media', 'verbose']
  })

  const [file] = positional
  if (!file) throw new Error('Pass the export file: scripts/import-wxr.mjs wordpress-export.xml')

  const site = parseWxr(await readFile(file, 'utf-8'))
  const db = await getDb()

  console.log(`Importing ${file}: "${site.meta.title}" (${site.meta.baseUrl || site.meta.link}, WXR ${site.meta.wxrVersion})`)
  console.log(
    `Found ${site.posts.filter((p) => p.type === 'post').length} post(s), ` +
      `${site.posts.filter((p) => p.type === 'page').length} page(s), ` +
      `${site.comments.length} comment(s), ${site.media.length} attachment(s), ` +
      `${site.authors.length} author(s).`
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
