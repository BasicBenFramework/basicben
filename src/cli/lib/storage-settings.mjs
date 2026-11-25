/**
 * The storage settings, for the backup and restore commands.
 *
 * Read fresh from the database (and decrypted with APP_KEY), since a CLI run
 * has no request to have refreshed them. Null when S3_BUCKET is set, when no
 * bucket is saved in Settings, or when the settings cannot be read — a
 * database being restored into may not have them yet.
 */

import { refreshConfig } from '../../helpers/config.ts'
import { settingsStorageConfig } from '../../helpers/storage.ts'

export async function storageSettings() {
  if (process.env.S3_BUCKET?.trim()) return null
  try {
    await refreshConfig({ force: true })
    return settingsStorageConfig()
  } catch {
    return null
  }
}
