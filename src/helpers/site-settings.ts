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

export type SettingGroup = 'general' | 'reading' | 'discussion' | 'integrations' | 'identity' | 'locale' | 'code_injection' | 'analytics' | 'members'

/** A validator returns the value to store, or an error message. */
type Check = (value: unknown) => { value: string } | { error: string }

interface SettingDefinition {
  group: SettingGroup
  check: Check
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
 * Who may become a member. See MemberController.
 *
 * - `open`: anyone may sign up with a magic link.
 * - `invite`: only addresses an admin added or imported may sign in.
 * - `closed`: no magic links at all. Existing sessions run until they end.
 */
export const MEMBER_SIGNUP_MODES = ['open', 'invite', 'closed'] as const

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
  // Whether this app renders the public site itself with the reference theme
  // (`ssr`) or leaves it to the SPA / a headless front end (blank). The
  // PUBLIC_THEME environment variable, when set, wins: `ssr` or `off`.
  public_theme: { group: 'reading', check: oneOf(['', 'ssr']) },

  allow_comments: { group: 'discussion', check: flag },
  moderate_comments: { group: 'discussion', check: flag },

  public_api: { group: 'integrations', check: flag },
  webhook_urls: { group: 'integrations', check: urlList },

  site_logo: { group: 'identity', check: imageUrl },
  site_icon: { group: 'identity', check: imageUrl },
  default_social_image: { group: 'identity', check: imageUrl },

  timezone: { group: 'locale', check: timeZone },
  locale: { group: 'locale', check: locale },

  code_injection_head: { group: 'code_injection', check: text(100_000) },
  code_injection_foot: { group: 'code_injection', check: text(100_000) },

  // Cookieless page-view counting (docs/analytics.md). Unset means on: the
  // ingest endpoint does nothing until a front end calls it anyway.
  analytics_enabled: { group: 'analytics', check: flag },
  // How long a visitor hash may live, in hours. Hashes are deleted when their
  // UTC day ends regardless — the day's salt goes with it — so more than 24
  // buys nothing; less trades accuracy (a reader returning later the same day
  // counts again) for holding even pseudonymous data for a shorter time.
  analytics_dedup_hours: { group: 'analytics', check: integer(1, 24) },
  // Days of daily counts to keep. 0 keeps them indefinitely — they are counts,
  // not personal data, so the default is to keep them.
  analytics_retention_days: { group: 'analytics', check: integer(0, 3650) },

  // Members and newsletters. The sign-in URL is the front-end page a magic
  // link opens — a setting, not a request parameter, so a caller can never
  // have a link (and the token in it) delivered to a page of their choosing.
  members_signup: { group: 'members', check: oneOf(MEMBER_SIGNUP_MODES) },
  members_signin_url: { group: 'members', check: httpUrlOrBlank },
  newsletter_sender_name: { group: 'members', check: text(100) },
  newsletter_reply_to: { group: 'members', check: emailOrBlank },
  newsletter_footer: { group: 'members', check: text(2000) }
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
