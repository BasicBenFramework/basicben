#!/usr/bin/env node
/**
 * Export the whole site to one JSON file.
 *
 * The same document the admin's Tools → Export button downloads, for when a
 * shell is closer than a browser — a cron backup, or a database too large for
 * a request to stream comfortably. Read back with `scripts/import-json.mjs`.
 *
 * Usage:
 *   node --env-file=.env scripts/export.mjs [options]
 *
 *   --out FILE     where to write (default basicben-export-YYYY-MM-DD.json;
 *                  `-` for stdout)
 *   --revisions    include post revision history (off by default: it can be
 *                  most of the file)
 *
 * The database is whatever the app uses — DATABASE_URL, TURSO_URL, or
 * basicben.config.js — exactly as `basicben migrate` resolves it.
 *
 * What is left out: password hashes, session versions, two-factor secrets,
 * passkeys, API token hashes, email/reset tokens and rate-limiter state, plus
 * any setting whose key looks like a credential. The file records what it
 * omitted under `omitted`. See docs/import-export.md for the format.
 */

import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { getDb } from '@basicbenframework/core/db'
import { exportChunks, EXPORT_FORMAT } from '../src/helpers/export-data.ts'
import { parseArgs } from './lib/import-common.mjs'

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2), {
    flags: ['revisions'],
    options: ['out']
  })

  const outPath = options.out ?? `${EXPORT_FORMAT}-${new Date().toISOString().slice(0, 10)}.json`
  const toStdout = outPath === '-'
  const out = toStdout ? process.stdout : createWriteStream(outPath)
  const db = await getDb()

  for await (const chunk of exportChunks(db, { revisions: flags.revisions })) {
    if (!out.write(chunk)) await once(out, 'drain')
  }

  if (toStdout) {
    out.write('\n')
    return
  }

  out.end('\n')
  await once(out, 'finish')
  console.error(`Exported to ${outPath}`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`\nExport failed: ${error.message}`)
    process.exit(1)
  }
)
