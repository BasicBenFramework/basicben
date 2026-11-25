/**
 * The media library's storage: what the CMS calls instead of core's
 * `getStorage()`.
 *
 * - S3_BUCKET set: core's storage, configured from basicben.config.js and the
 *   S3_* variables, exactly as before.
 * - Otherwise, a bucket in the storage settings (helpers/config.ts): an S3
 *   adapter built from them, reusing the site config's other options such as
 *   `maxSize`. Rebuilt when the settings change.
 * - Neither: core's storage again, which is the local driver.
 */

import { getStorage as coreStorage, createStorage } from '@basicbenframework/core/storage'
import { loadConfig } from '@basicbenframework/core/server'
import { configValue } from './config.ts'

let cached: { fingerprint: string; storage: any } | null = null

/** The storage settings in use, or null when they are not what configures storage. */
export function settingsStorageConfig(): Record<string, string> | null {
  if (process.env.S3_BUCKET?.trim()) return null

  const bucket = configValue('S3_BUCKET')
  const accessKeyId = configValue('S3_ACCESS_KEY_ID')
  const secretAccessKey = configValue('S3_SECRET_ACCESS_KEY')
  if (!bucket || !accessKeyId || !secretAccessKey) return null

  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint: configValue('S3_ENDPOINT'),
    region: configValue('S3_REGION') || 'auto',
    publicUrl: configValue('S3_PUBLIC_URL')
  }
}

export async function getStorage(): Promise<any> {
  const fromSettings = settingsStorageConfig()
  if (!fromSettings) return coreStorage()

  const fingerprint = JSON.stringify(fromSettings)
  if (cached?.fingerprint === fingerprint) return cached.storage

  const site = ((await loadConfig()) as any)?.storage || {}
  // Only the options that are not about which bucket: the site config may name
  // the local driver or an upload path that has nothing to do with this one.
  const storage = await createStorage({
    ...(site.maxSize !== undefined ? { maxSize: site.maxSize } : {}),
    ...(site.allowedTypes ? { allowedTypes: site.allowedTypes } : {}),
    driver: 's3',
    ...Object.fromEntries(Object.entries(fromSettings).filter(([, value]) => value !== ''))
  })

  cached = { fingerprint, storage }
  return storage
}

/** Which configures storage right now, for the health screen. */
export function storageSource(): 'env' | 'settings' | 'default' {
  if (process.env.S3_BUCKET?.trim()) return 'env'
  return settingsStorageConfig() ? 'settings' : 'default'
}
