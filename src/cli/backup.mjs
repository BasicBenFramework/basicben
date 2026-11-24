#!/usr/bin/env node
/**
 * Take a full backup of the site.
 *
 * Writes the JSON export — revisions included — to a timestamped file, and
 * optionally gzips it, adds a scrubbed SQLite snapshot, uploads both to an S3
 * bucket and deletes backups beyond the newest N. Meant for a cron:
 *
 *   npm run backup -- --gzip --s3 --keep 14
 *
 * Options:
 *   --dir DIR         where to write (default ./backups; created if missing)
 *   --gzip            compress the JSON (node:zlib)
 *   --sqlite-copy     also write a consistent copy of a SQLite database via
 *                     VACUUM INTO, with credentials scrubbed out
 *   --s3              upload to BACKUP_S3_BUCKET (or the media bucket's S3_*
 *                     settings) under --prefix
 *   --prefix NAME     bucket folder (default backups/)
 *   --keep N          keep the newest N backups — locally, and in the bucket
 *                     with --s3 — and delete the rest
 *   --no-revisions    leave post revision history out (smaller file)
 *   --remove-local    with --s3, delete the local files after uploading
 *
 * Restore with `basicben-cms restore`. See docs/backup.md.
 *
 * Backups contain personal data (email addresses). They contain no secrets:
 * the export omits password hashes, two-factor secrets, passkeys, API and
 * email tokens, rate-limiter state and credential-looking settings, and the
 * SQLite copy has the same removed before it is written.
 */

import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { getDb } from '@basicbenframework/core/db'
import { createS3Adapter } from '@basicbenframework/core/storage'
import { parseArgs } from './lib/import-common.mjs'
import {
  PERSONAL_DATA_WARNING,
  backupBaseName,
  backupStorageConfig,
  normalizePrefix,
  writeJsonBackup,
  sqliteSnapshot,
  pruneLocal,
  pruneBucket
} from './lib/backup.mjs'
import { recordHeartbeat, HEARTBEATS } from '../helpers/heartbeat.ts'

const log = (line = '') => console.error(line)
const size = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`)

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2), {
    flags: ['gzip', 'sqlite-copy', 's3', 'no-revisions', 'remove-local'],
    options: ['dir', 'prefix', 'keep']
  })

  const keep = options.keep === undefined ? null : Number(options.keep)
  if (keep !== null && (!Number.isInteger(keep) || keep < 1)) throw new Error('--keep must be a whole number of at least 1')

  const prefix = normalizePrefix(options.prefix ?? 'backups/')
  const dir = resolve(options.dir ?? 'backups')
  await mkdir(dir, { recursive: true, mode: 0o700 })

  // Resolved before any work, so a misconfigured upload fails in a second
  // rather than after a ten-minute export.
  let bucket = null
  if (flags.s3) {
    const resolved = backupStorageConfig(process.env)
    if (!resolved) {
      throw new Error('--s3 needs BACKUP_S3_BUCKET (or S3_BUCKET) with an access key id and secret. See docs/backup.md.')
    }
    if (resolved.shared) {
      log(`Uploading to the media bucket "${resolved.config.bucket}" under ${prefix}.`)
      if (resolved.publicMediaUrl) {
        log('WARNING: S3_PUBLIC_URL is set, so this bucket may be publicly readable. If every key in it is')
        log('served publicly (R2 custom domains are), so is this backup. Set BACKUP_S3_BUCKET to a private bucket.')
      }
    }
    bucket = createS3Adapter(resolved.config)
  }

  const db = await getDb()
  const now = new Date()
  const base = backupBaseName(now)
  const written = []

  log(PERSONAL_DATA_WARNING)
  log('')

  const jsonPath = join(dir, `${base}.json${flags.gzip ? '.gz' : ''}`)
  const jsonBytes = await writeJsonBackup(db, jsonPath, { gzip: flags.gzip, revisions: !flags['no-revisions'], now })
  written.push(jsonPath)
  log(`Wrote ${jsonPath} (${size(jsonBytes)})`)

  if (flags['sqlite-copy']) {
    const dbPath = join(dir, `${base}.sqlite`)
    const dbBytes = await sqliteSnapshot(db, dbPath)
    written.push(dbPath)
    log(`Wrote ${dbPath} (${size(dbBytes)}, credentials scrubbed)`)
  }

  if (bucket) {
    for (const path of written) {
      const key = `${prefix}${basename(path)}`
      // Read whole: the framework's S3 put signs a body it can hash. Fine for
      // a blog's database; a multi-gigabyte one wants the provider's backups.
      await bucket.put(key, await readFile(path), {
        contentType: path.endsWith('.gz') ? 'application/gzip' : path.endsWith('.json') ? 'application/json' : 'application/vnd.sqlite3',
        cacheControl: 'no-store'
      })
      log(`Uploaded s3://${bucket.bucket}/${key}`)
    }

    if (flags['remove-local']) {
      for (const path of written) await rm(path, { force: true })
      log('Removed the local copies.')
    }
  }

  if (keep !== null) {
    const local = await pruneLocal(dir, keep)
    for (const name of local) log(`Deleted old local backup ${name}`)

    if (bucket) {
      const remote = await pruneBucket(bucket, prefix, keep)
      for (const key of remote) log(`Deleted old bucket backup ${key}`)
    }
  }

  // Best-effort: the health page reads this. A file name, never a path that
  // might reveal more about the machine, and nothing else.
  await recordHeartbeat(db, HEARTBEATS.BACKUP, {
    file: basename(jsonPath),
    bytes: jsonBytes,
    sqlite_copy: Boolean(flags['sqlite-copy']),
    uploaded: Boolean(bucket)
  }, now)

  log('\nBackup complete.')
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`\nBackup failed: ${error.message}`)
    process.exit(1)
  }
)
