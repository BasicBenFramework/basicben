#!/usr/bin/env node
/**
 * Restore a backup from `basicben-cms backup` into an empty database.
 *
 *   npm run migrate                                  # an empty, current schema
 *   npm run restore -- backups/basicben-backup-….json.gz --dry-run
 *   npm run restore -- backups/basicben-backup-….json.gz --reset-password you@example.com
 *
 * Options:
 *   --dry-run               do the whole restore in a transaction and roll it
 *                           back; prints what would be written
 *   --force                 restore into a database that already has content
 *                           (merges: existing rows matched by slug/email are
 *                           left alone). Dry-run it first.
 *   --s3 KEY                read the backup from the backup bucket instead of
 *                           a local file (same BACKUP_S3_* / S3_* settings)
 *   --reset-password EMAIL  after restoring, give that account a new random
 *                           password and print it once
 *   --verbose               print every row written
 *
 * Accepts `.json` and `.json.gz` (detected from the content, not the name).
 * A `.sqlite` copy is not restored by this script — it is already a database:
 * stop the app and put the file where DATABASE_URL points. See docs/backup.md.
 *
 * Backups carry no password hashes, so every restored account signs in by
 * resetting its password; --reset-password gets one admin in without email.
 */

import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { getDb } from '@basicbenframework/core/db'
import { createS3Adapter } from '@basicbenframework/core/storage'
import { hashPassword } from '@basicbenframework/core/auth'
import { parseArgs } from './lib/import-common.mjs'
import { readExport } from './lib/json-import.mjs'
import { restoreBackup, isGzip, backupStorageConfig } from './lib/backup.mjs'

async function load(file, s3Key) {
  if (s3Key) {
    const resolved = backupStorageConfig(process.env)
    if (!resolved) throw new Error('--s3 needs BACKUP_S3_BUCKET (or S3_BUCKET) with an access key id and secret.')
    const object = await createS3Adapter(resolved.config).get(s3Key)
    return object.body
  }

  if (!file) throw new Error('Pass the backup file: basicben-cms restore backups/basicben-backup-….json.gz')
  if (/\.sqlite$/.test(file)) {
    throw new Error('That is a SQLite copy, not a JSON backup. Stop the app and copy it to where DATABASE_URL points (docs/backup.md).')
  }
  return readFile(file)
}

async function main() {
  const { flags, options, positional } = parseArgs(process.argv.slice(2), {
    flags: ['dry-run', 'force', 'verbose'],
    options: ['s3', 'reset-password']
  })

  const raw = await load(positional[0], options.s3)
  const doc = readExport((isGzip(raw) ? gunzipSync(raw) : raw).toString('utf-8'))
  const db = await getDb()

  // An unmigrated target fails later with "no such table", which reads like
  // a broken backup. Say what is actually wrong.
  try {
    await db.get('SELECT 1 FROM users LIMIT 1')
  } catch {
    throw new Error('The target database has no schema. Run `npm run migrate` first, then restore.')
  }

  console.log(`Restoring ${options.s3 ? `s3:${options.s3}` : positional[0]} (format v${doc.version}, exported ${doc.exported_at})`)
  if (flags['dry-run']) console.log('Dry run — nothing will be written.')
  console.log('')

  const result = await restoreBackup(db, doc, {
    force: flags.force,
    dryRun: flags['dry-run'],
    log: flags.verbose ? console.log : undefined
  })

  console.log(`Accounts\n${result.accounts}\n\nContent\n${result.content}`)

  if (flags['dry-run']) {
    console.log('\nDry run complete. Nothing was written.')
    return
  }

  if (options['reset-password']) {
    const email = String(options['reset-password']).toLowerCase()
    const user = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [email])
    if (!user) throw new Error(`Restored, but no account has the address ${email}, so no password was set.`)

    // Printed once, to this terminal, and never stored anywhere but as a
    // hash. Change it after signing in.
    const password = randomBytes(15).toString('base64url')
    await db.run('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(password), user.id])
    console.log(`\nTemporary password for ${email}: ${password}\nSign in and change it from your Profile.`)
  }

  console.log('\nRestore complete. Media files are not part of a backup; they stay in your storage bucket.')
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`\nRestore failed: ${error.message}`)
    process.exit(1)
  }
)
