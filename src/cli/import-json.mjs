#!/usr/bin/env node
/**
 * Import a BasicBen export (from Tools → Export or `basicben-cms export`).
 *
 * For moving a site between databases. Safe to re-run: rows are matched on
 * their natural keys (slug, address, object key, setting key) and existing
 * ones are left alone, so a second run adds nothing. Ids are remapped, so the
 * target can already have content.
 *
 * Usage:
 *   npx basicben-cms import:json FILE [options]
 *
 *   --dry-run   report what would change, write nothing
 *   --update    overwrite matching posts, pages, terms, media and settings
 *               with the file's values (user accounts are never changed)
 *   --verbose   print every row written
 *
 * Imported accounts keep their role but have no password — an export never
 * carries one — so each signs in through "forgot password". Two-factor,
 * passkeys and API tokens are not exported and must be set up again.
 *
 * Needs an admin account in the target to own anything whose author did not
 * come across. See docs/import-export.md.
 */

import { readFile } from 'node:fs/promises'
import { getDb } from '@basicbenframework/core/db'
import { parseArgs, withDryRun, defaultAuthor, NO_ADMIN_MESSAGE } from './lib/import-common.mjs'
import { readExport, importExport } from './lib/json-import.mjs'

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), {
    flags: ['dry-run', 'update', 'verbose']
  })

  const [file] = positional
  if (!file) throw new Error('Pass the export file: basicben-cms import:json basicben-export.json')

  const doc = readExport(await readFile(file, 'utf-8'))
  const db = await getDb()
  const admin = await defaultAuthor(db)

  if (!admin) {
    console.error(NO_ADMIN_MESSAGE)
    process.exit(1)
  }

  console.log(`Importing ${file} (format v${doc.version}, exported ${doc.exported_at})`)
  if (flags['dry-run']) console.log('Dry run — nothing will be written.')
  if (flags.update) console.log('Updating rows that already exist.')
  console.log('')

  const report = await withDryRun(db, flags['dry-run'], (tx) =>
    importExport(tx, doc, {
      defaultAuthorId: admin.id,
      update: flags.update,
      log: flags.verbose ? console.log : undefined
    })
  )

  console.log(`\n${report}`)
  if (flags['dry-run']) console.log('\nDry run complete. Nothing was written.')
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`\nImport failed: ${error.message}`)
    process.exit(1)
  }
)
