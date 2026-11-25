/**
 * Every setting the admin may write, and what a valid value for each looks like.
 *
 * `PUT /api/settings` used to store whatever keys it was sent. That made the
 * settings table a free-form key/value store for anyone holding
 * `settings.manage`, and — worse — a typo in a client (`alow_comments`) saved
 * cleanly and did nothing, with no error to say so. An allowlist turns both
 * into a 422 naming the key.
 *
 * Adding a setting means adding it here. That is deliberate: it is the one
 * place that says what the setting is, which group it belongs to and what it
 * accepts, and the admin and the public site API both read from it.
 *
 * No database access in this file, so tests import it directly.
 */

import { isHttpUrl, isRelativePath, MAX_URL_LENGTH } from './content-paths.ts'

// Core's groups, plus any a feature names when it defines settings.
export type SettingGroup = 'general' | 'reading' | 'discussion' | 'integrations' | 'identity' | 'locale' | 'code_injection' | (string & {})

/** A validator returns the value to store, or an error message. */
export type Check = (value: unknown) => { value: string } | { error: string }

export interface SettingDefinition {
  group: SettingGroup
  check: Check
  /**
   * Stored encrypted, never sent back to the admin (see helpers/config.ts).
   * A blank value on save keeps the stored one; DELETE clears it.
   */
  secret?: boolean
}

const text = (max: number, { required = false } = {}): Check => (value) => {
  if (value === null || value === undefined) value = ''
  if (typeof value !== 'string' && typeof value !== 'number') return { error: 'Must be text' }

  const str = String(value)

  if (required && str.trim() === '') return { error: 'Required' }
  if (str.length > max) return { error: `Must be at most ${max} characters` }

  return { value: str }
}

const flag: Check = (value) => {
  if (value === true || value === 'true') return { value: 'true' }
  if (value === false || value === 'false') return { value: 'false' }

  return { error: 'Must be true or false' }
}

const integer = (min: number, max: number): Check => (value) => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())

  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `Must be a whole number from ${min} to ${max}` }
  }

  return { value: String(n) }
}

/** One of a fixed list of values. Blank is allowed only if it is in the list. */
const oneOf = (allowed: readonly string[]): Check => (value) => {
  const str = value === null || value === undefined ? '' : String(value).trim()
  return allowed.includes(str) ? { value: str } : { error: `Must be one of: ${allowed.map((v) => v || '(blank)').join(', ')}` }
}

/**
 * An image reference: an absolute http(s) URL, or a path on this app such as
 * `/uploads/logo.png` (what the media library hands out with local storage).
 * Blank clears it.
 */
const imageUrl: Check = (value) => {
  if (value === null || value === undefined || value === '') return { value: '' }
  if (typeof value !== 'string') return { error: 'Must be a URL' }

  const url = value.trim()

  if (url.length > MAX_URL_LENGTH) return { error: 'URL is too long' }
  if (!isHttpUrl(url) && !isRelativePath(url)) {
    return { error: 'Must be an http(s) URL or a path starting with /' }
  }

  return { value: url }
}

/**
 * One http(s) URL per line. `getWebhookUrls()` already skips anything else at
 * delivery time, but silently — refusing it here is what tells the admin.
 */
const urlList: Check = (value) => {
  const checked = text(10_000)(value)
  if ('error' in checked) return checked

  const bad = checked.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !isHttpUrl(line))

  if (bad.length) return { error: `Not an http(s) URL: ${bad[0]}` }

  return checked
}

/**
 * An IANA time zone name, such as `Europe/London` or `UTC`.
 *
 * `Intl.DateTimeFormat` is the authority on which names exist — it throws a
 * RangeError for one it does not know — but since ES2024 it also accepts raw
 * offsets like `+01:00`. An offset is not a time zone (it has no daylight
 * saving), and a front end formatting dates with one would be an hour wrong
 * for half the year, so the shape is checked first.
 */
export function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(value)) return false

  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

const timeZone: Check = (value) => {
  if (value === null || value === undefined || value === '') return { value: '' }
  if (typeof value !== 'string' || !isTimeZone(value.trim())) {
    return { error: 'Must be an IANA time zone, such as Europe/London or UTC' }
  }

  return { value: value.trim() }
}

/**
 * A BCP 47 language tag, stored in canonical form (`en-gb` becomes `en-GB`).
 *
 * `Intl.getCanonicalLocales` throws for anything that is not well-formed, and
 * canonicalising means a front end comparing tags does not have to.
 */
export function canonicalLocale(value: string): string | null {
  try {
    const [locale] = Intl.getCanonicalLocales(value)
    return locale ?? null
  } catch {
    return null
  }
}

const locale: Check = (value) => {
  if (value === null || value === undefined || value === '') return { value: '' }

  const canonical = typeof value === 'string' && value.length <= 35 ? canonicalLocale(value.trim()) : null

  return canonical ? { value: canonical } : { error: 'Must be a BCP 47 language tag, such as en or en-GB' }
}

/** An email address, or blank. Shape only — it is a Reply-To, not a login. */
const emailOrBlank: Check = (value) => {
  if (value === null || value === undefined || value === '') return { value: '' }
  if (typeof value !== 'string') return { error: 'Must be an email address' }

  const email = value.trim()
  if (email.length > 254 || !/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(email)) {
    return { error: 'Must be an email address' }
  }

  return { value: email }
}

/** An absolute http(s) URL, or blank. */
const httpUrlOrBlank: Check = (value) => {
  if (value === null || value === undefined || value === '') return { value: '' }
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH || !isHttpUrl(value.trim())) {
    return { error: 'Must be an http(s) URL' }
  }

  return { value: value.trim() }
}

/**
 * An image transform URL template: blank, or a template naming the image with
 * {url} or {url_encoded} and the size with {width}. It starts with http(s)://
 * or with {url} (Bunny's `{url}?width={width}`). See helpers/images.ts.
 */
const imageTransformTemplate: Check = (value) => {
  if (value === null || value === undefined || value === '') return { value: '' }
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return { error: 'Must be a URL template' }

  const template = value.trim()
  if (!/^(https?:\/\/|\{url\})/i.test(template)) return { error: 'Must start with http://, https:// or {url}' }
  if (!/\{url(_encoded)?\}/.test(template) || !template.includes('{width}')) {
    return { error: 'Must contain {url} or {url_encoded}, and {width}' }
  }

  return { value: template }
}

/**
 * The known settings.
 *
 * Code injection is HTML a front end inserts verbatim into every page's
 * <head> or before </body> — analytics snippets, verification tags, a font
 * stylesheet. It is intentionally **not** sanitised: a sanitiser would strip
 * exactly the <script> tags it exists to carry. What keeps it safe is who can
 * write it — these routes require `settings.manage`, which only the admin role
 * holds — the same trust WordPress and Ghost extend to their administrators.
 */
export const SETTINGS: Record<string, SettingDefinition> = {
  site_name: { group: 'general', check: text(200, { required: true }) },
  site_description: { group: 'general', check: text(1000) },

  posts_per_page: { group: 'reading', check: integer(1, 100) },
  robots_txt: { group: 'reading', check: text(10_000) },

  allow_comments: { group: 'discussion', check: flag },
  moderate_comments: { group: 'discussion', check: flag },

  public_api: { group: 'integrations', check: flag },
  webhook_urls: { group: 'integrations', check: urlList },

  site_logo: { group: 'identity', check: imageUrl },
  site_icon: { group: 'identity', check: imageUrl },
  default_social_image: { group: 'identity', check: imageUrl },

  timezone: { group: 'locale', check: timeZone },
  locale: { group: 'locale', check: locale },
  // The admin's language for everyone who has not picked one in Profile.
  // Any tag is stored; the admin falls back to English when it has no
  // dictionary for it (src/client/i18n).
  admin_locale: { group: 'locale', check: locale },

  code_injection_head: { group: 'code_injection', check: text(100_000) },
  code_injection_foot: { group: 'code_injection', check: text(100_000) },

  // Configuration the environment can also set, and then wins: see
  // helpers/config.ts. The site URL is where feeds and the sitemap link.
  site_url: { group: 'general', check: httpUrlOrBlank },
  disable_registration: { group: 'general', check: flag },
  image_transform_url: { group: 'media', check: imageTransformTemplate },

  // Object storage for the media library, as the S3_* variables would set it.
  storage_bucket: { group: 'storage', check: text(255) },
  storage_endpoint: { group: 'storage', check: httpUrlOrBlank },
  storage_region: { group: 'storage', check: text(64) },
  storage_public_url: { group: 'storage', check: httpUrlOrBlank },
  storage_access_key_id: { group: 'storage', check: text(256), secret: true },
  storage_secret_access_key: { group: 'storage', check: text(256), secret: true }
}

/**
 * The validators, for a feature defining its own settings
 * (`host.settings.define`). Same rules as core's, so a feature's settings are
 * checked exactly as strictly.
 */
export const checks = { text, flag, integer, oneOf, imageUrl, urlList, timeZone, locale, emailOrBlank, httpUrlOrBlank }

export function isSecretDefinition(key: string): boolean {
  return Boolean(SETTINGS[key]?.secret)
}

/**
 * Add a feature's settings to the allowlist. A key core or another feature
 * already defines is refused: two owners for one setting is a bug to catch at
 * boot, not a silent overwrite.
 */
export function defineSettings(definitions: Record<string, SettingDefinition>): void {
  for (const [key, definition] of Object.entries(definitions)) {
    if (Object.hasOwn(SETTINGS, key)) throw new Error(`Setting "${key}" is already defined`)
    SETTINGS[key] = definition
  }
}

export function isKnownSetting(key: string): boolean {
  return Object.hasOwn(SETTINGS, key)
}

export type ValidatedSettings =
  | { values: Record<string, { value: string; group: SettingGroup }> }
  | { errors: Record<string, string[]> }

/**
 * Validate a batch of settings. All or nothing: one bad key and nothing is
 * written, so a save never leaves the site half-configured.
 */
export function validateSettings(input: unknown): ValidatedSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: { settings: ['Settings object is required'] } }
  }

  const values: Record<string, { value: string; group: SettingGroup }> = {}
  const errors: Record<string, string[]> = {}

  for (const [key, raw] of Object.entries(input)) {
    if (!isKnownSetting(key)) {
      errors[key] = ['Unknown setting']
      continue
    }

    const { group, check } = SETTINGS[key]
    const result = check(raw)

    if ('error' in result) errors[key] = [result.error]
    else values[key] = { value: result.value, group }
  }

  return Object.keys(errors).length ? { errors } : { values }
}

/** Defaults the public site API reports for settings nobody has set yet. */
export const SITE_DEFAULTS = {
  timezone: 'UTC',
  locale: 'en'
}
