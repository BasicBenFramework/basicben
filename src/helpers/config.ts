/**
 * Configuration an admin may set from the Settings screen, with the
 * environment taking priority.
 *
 * Each entry pairs an environment variable with a site setting. When the
 * variable is set it wins and the setting is locked in the admin, so a
 * deployment configured through its environment (every one before this)
 * behaves exactly as it did. When it is not set, the setting is used.
 *
 * What stays environment-only, and why: the database connection (settings live
 * in the database), APP_KEY (it signs sessions and encrypts the secrets here),
 * CRON_SECRET and the webhook secrets (they authenticate requests to this
 * server), and TRUST_PROXY, PORT and NODE_ENV (how the server runs). None of
 * those should be one stolen admin session away from changing.
 *
 * Reads are synchronous, from a snapshot of the settings. `refreshConfig()`
 * reloads it at most every 30 seconds per instance (on each request, through
 * the `request.before` hook in src/hooks.ts) and at once after an admin saves.
 * On a serverless platform another instance can therefore act on the old
 * value for up to 30 seconds after a change.
 *
 * Secret settings are stored encrypted (helpers/secrets.ts), decrypted only
 * into this snapshot, never sent to the browser, and left out of exports and
 * backups by the secret-setting rule in helpers/export-data.ts.
 */

import { getDb } from '@basicbenframework/core/db'
import { decryptSecret } from './secrets.ts'

export type ConfigGroup = 'site' | 'media' | 'storage' | 'mail'

export interface ConfigEntry {
  /** The environment variable. It wins when set. */
  env: string
  /** The site setting used when the variable is not set. */
  setting: string
  label: string
  group: ConfigGroup
  /** Stored encrypted, never sent back to the admin. */
  secret?: boolean
  /**
   * Variables that, when any is set, put this entry under the environment
   * even if its own variable is not. Storage is configured as a whole: a
   * bucket from the environment with keys from settings would be two halves
   * of two configurations.
   */
  lockedBy?: string[]
  /**
   * The feature this belongs to. Its row is left out of the status list on a
   * server that does not run that feature, where "unset" would read as a fault.
   */
  feature?: string
}

const STORAGE_ENV = ['S3_BUCKET']

export const CONFIG: ConfigEntry[] = [
  { env: 'SITE_NAME', setting: 'site_name', label: 'Site name', group: 'site' },
  { env: 'SITE_URL', setting: 'site_url', label: 'Site URL', group: 'site' },
  { env: 'DISABLE_REGISTRATION', setting: 'disable_registration', label: 'Registration closed', group: 'site' },
  { env: 'PUBLIC_THEME', setting: 'public_theme', label: 'Public theme', group: 'site' },

  { env: 'IMAGE_TRANSFORM_URL', setting: 'image_transform_url', label: 'Image transform URL', group: 'media' },

  { env: 'S3_BUCKET', setting: 'storage_bucket', label: 'Bucket', group: 'storage', lockedBy: STORAGE_ENV },
  { env: 'S3_ENDPOINT', setting: 'storage_endpoint', label: 'Endpoint', group: 'storage', lockedBy: STORAGE_ENV },
  { env: 'S3_REGION', setting: 'storage_region', label: 'Region', group: 'storage', lockedBy: STORAGE_ENV },
  { env: 'S3_PUBLIC_URL', setting: 'storage_public_url', label: 'Public URL', group: 'storage', lockedBy: STORAGE_ENV },
  { env: 'S3_ACCESS_KEY_ID', setting: 'storage_access_key_id', label: 'Access key ID', group: 'storage', secret: true, lockedBy: STORAGE_ENV },
  { env: 'S3_SECRET_ACCESS_KEY', setting: 'storage_secret_access_key', label: 'Secret access key', group: 'storage', secret: true, lockedBy: STORAGE_ENV },

  { env: 'MYSENDBOX_API_KEY', setting: 'mysendbox_api_key', label: 'MySendbox API key', group: 'mail', secret: true, feature: 'mysendbox' },
  { env: 'MYSENDBOX_API_URL', setting: 'mysendbox_api_url', label: 'MySendbox API URL', group: 'mail', feature: 'mysendbox' }
]

const byEnv = new Map(CONFIG.map((entry) => [entry.env, entry]))
const bySetting = new Map(CONFIG.map((entry) => [entry.setting, entry]))

const TTL_MS = 30_000

/** Setting values (secrets decrypted), and secrets that would not decrypt. */
let snapshot: Record<string, string> = {}
let unreadable = new Set<string>()
let loadedAt = 0
let loading: Promise<void> | null = null

const envValue = (name: string, env = process.env) => env[name]?.trim() || ''

/** The environment variable that controls a setting right now, or null. */
export function lockedBy(setting: string, env = process.env): string | null {
  const entry = bySetting.get(setting)
  if (!entry) return null
  if (envValue(entry.env, env)) return entry.env
  return entry.lockedBy?.find((name) => envValue(name, env)) ?? null
}

export function isSecretConfig(setting: string): boolean {
  return Boolean(bySetting.get(setting)?.secret)
}

/** The value for an environment variable's name: the variable, else its setting, else ''. */
export function configValue(env: string): string {
  const entry = byEnv.get(env)
  if (!entry) return envValue(env)

  const fromEnv = envValue(entry.env)
  if (fromEnv) return fromEnv
  if (lockedBy(entry.setting)) return ''

  return snapshot[entry.setting]?.trim() || ''
}

export type ConfigSource = 'env' | 'settings' | 'unset' | 'unreadable'

export interface ConfigStatus {
  env: string
  setting: string
  label: string
  group: ConfigGroup
  secret: boolean
  source: ConfigSource
  /** The variable that locks this setting, when one does. */
  locked_by: string | null
  /** The value in use, for entries that are not secret. */
  value: string | null
}

/** Where each value comes from, for the admin. Never a secret's value. */
/**
 * Where each setting comes from, for Health and Settings. With `features`
 * (the features this server registered), entries of other features are left
 * out.
 */
export function describeConfig(features?: string[]): ConfigStatus[] {
  const entries = features ? CONFIG.filter((entry) => !entry.feature || features.includes(entry.feature)) : CONFIG
  return entries.map((entry) => {
    const locked = lockedBy(entry.setting)
    const value = configValue(entry.env)

    let source: ConfigSource = 'unset'
    if (envValue(entry.env)) source = 'env'
    else if (!locked && value) source = 'settings'
    else if (!locked && unreadable.has(entry.setting)) source = 'unreadable'

    return {
      env: entry.env,
      setting: entry.setting,
      label: entry.label,
      group: entry.group,
      secret: Boolean(entry.secret),
      source,
      locked_by: locked,
      value: entry.secret ? null : value || null
    }
  })
}

/**
 * Reload the snapshot when it is older than 30 seconds, or now with `force`.
 * A failed read (no settings table yet, database down) keeps the old one.
 */
export async function refreshConfig({ force = false } = {}): Promise<void> {
  if (!force && loadedAt && Date.now() - loadedAt < TTL_MS) return
  if (loading && !force) return loading

  loading = (async () => {
    try {
      const keys = CONFIG.map((entry) => entry.setting)
      const db = await getDb()
      const rows = (await db.all(
        `SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(', ')})`,
        keys
      )) as Array<{ key: string; value: string | null }>

      const next: Record<string, string> = {}
      const failed = new Set<string>()
      for (const { key, value } of rows) {
        if (!value) continue
        if (isSecretConfig(key)) {
          const plain = decryptSecret(value)
          if (plain === null) failed.add(key)
          else next[key] = plain
        } else {
          next[key] = value
        }
      }

      snapshot = next
      unreadable = failed
      loadedAt = Date.now()
    } catch {
      // Keep what we had. Try again on the next request rather than after the TTL.
      loadedAt = 0
    } finally {
      loading = null
    }
  })()

  return loading
}

/** For tests: replace the snapshot. */
export function setConfigSnapshot(values: Record<string, string>): void {
  snapshot = { ...values }
  unreadable = new Set()
  loadedAt = Date.now()
}

/** The site's name: SITE_NAME, else the Site Name setting, else `fallback`. */
export function siteName(fallback = 'BasicBen'): string {
  return configValue('SITE_NAME') || fallback
}

/** False when DISABLE_REGISTRATION (or the setting) is 'true'. The first account can always register. */
export function registrationOpen(): boolean {
  return configValue('DISABLE_REGISTRATION') !== 'true'
}
