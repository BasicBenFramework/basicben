import { getDb } from '@basicbenframework/core/db'
import { absoluteUrl } from '@basicbenframework/core/storage'
import type { Settings as SettingsType } from '../types/index.ts'
import { SITE_DEFAULTS } from '../helpers/site-settings.ts'
import { siteUrl } from '../helpers/site.ts'
import { configValue } from '../helpers/config.ts'

/** What `/api/v1/site` reports. See `siteInfo()`. */
export interface PublicSiteInfo {
  name: string
  description: string
  /** The public site's origin: SITE_URL, else the Site URL setting, else APP_URL. */
  url: string
  /** Absolute URL of the logo, or null. */
  logo_url: string | null
  /** Absolute URL of the favicon / app icon, or null. */
  icon_url: string | null
  /** Image to use for social cards when a post or page has none of its own. */
  default_social_image_url: string | null
  /** The brand colour (Settings → Site Identity), lower-case `#rrggbb`, or null. */
  accent_color: string | null
  /** IANA time zone the site's dates should be shown in. */
  timezone: string
  /** BCP 47 language tag, for `<html lang>` and date formatting. */
  locale: string
  /**
   * Admin-authored HTML for the front end to insert verbatim. Not sanitised —
   * see `SETTINGS` in helpers/site-settings.ts for why that is safe.
   */
  code_injection: { head: string; foot: string }
}

export const Settings = {
  async all(): Promise<SettingsType[]> {
    const db = await getDb()
    return db.all('SELECT * FROM settings ORDER BY group_name, key')
  },

  async byGroup(groupName: string): Promise<SettingsType[]> {
    const db = await getDb()
    return db.all(
      'SELECT * FROM settings WHERE group_name = ? ORDER BY key',
      [groupName]
    )
  },

  async get(key: string): Promise<string | null> {
    const db = await getDb()
    const result = await db.get('SELECT value FROM settings WHERE key = ?', [key])
    return result?.value || null
  },

  async getTyped<T>(key: string, defaultValue: T): Promise<T> {
    const value = await this.get(key)
    if (value === null) return defaultValue

    try {
      return JSON.parse(value) as T
    } catch {
      return value as unknown as T
    }
  },

  // The group is rewritten on conflict too. Keys saved through the old
  // free-form update all landed in 'general'; saving them again files them
  // where their definition in helpers/site-settings.ts says they belong.
  async set(key: string, value: string | number | boolean | object, groupName = 'general'): Promise<void> {
    const db = await getDb()
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
    const now = new Date().toISOString()

    await db.run(`
      INSERT INTO settings (key, value, group_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, group_name = ?, updated_at = ?
    `, [key, stringValue, groupName, now, now, stringValue, groupName, now])
  },

  async setMany(settings: Record<string, string | number | boolean | object>, groupName = 'general'): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.set(key, value, groupName)
    }
  },

  async delete(key: string): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM settings WHERE key = ?', [key])
  },

  async asObject(groupName?: string): Promise<Record<string, string>> {
    const settings = groupName ? await this.byGroup(groupName) : await this.all()
    return settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value || ''
      return acc
    }, {} as Record<string, string>)
  },

  // Convenience methods for common settings
  // SITE_NAME, when set, wins over the setting: see helpers/config.ts.
  async getSiteName(): Promise<string> {
    return configValue('SITE_NAME') || (await this.get('site_name')) || 'My BasicBen Blog'
  },

  async getSiteDescription(): Promise<string> {
    return (await this.get('site_description')) || ''
  },

  async getPostsPerPage(): Promise<number> {
    const value = await this.get('posts_per_page')
    return value ? parseInt(value, 10) : 10
  },

  async getAllowComments(): Promise<boolean> {
    const value = await this.get('allow_comments')
    return value === 'true'
  },

  /**
   * Webhook receivers, one URL per line in the setting.
   *
   * Non-http entries are dropped rather than attempted: a typo would otherwise
   * produce a delivery failure on every content change, logged forever.
   */
  async getWebhookUrls(): Promise<string[]> {
    const value = await this.get('webhook_urls')

    if (!value) return []

    return value
      .split('\n')
      .map(url => url.trim())
      .filter(url => /^https?:\/\//i.test(url))
  },

  async setWebhookUrls(urls: string[]): Promise<void> {
    await this.set('webhook_urls', urls.join('\n'), 'integrations')
  },

  async getModerateComments(): Promise<boolean> {
    const value = await this.get('moderate_comments')
    return value !== 'false' // Default to true
  },

  /**
   * The site's identity, for a headless front end to render its chrome from.
   *
   * One query rather than a `get()` per key: this sits behind a public,
   * cacheable route that every page build of a front end may hit.
   *
   * Image settings may be stored as app-relative paths (`/uploads/logo.png`,
   * what local storage hands out); they are made absolute against APP_URL
   * here, because a front end on another host has nothing to resolve them
   * against — the same reason media URLs are absolute in the content API.
   */
  async siteInfo(): Promise<PublicSiteInfo> {
    const db = await getDb()
    const rows = (await db.all(
      `SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['site_name', 'site_description', 'site_logo', 'site_icon', 'default_social_image', 'accent_color',
        'timezone', 'locale', 'code_injection_head', 'code_injection_foot']
    )) as Array<{ key: string; value: string | null }>

    const value = (key: string) => rows.find(row => row.key === key)?.value || ''
    const image = (key: string) => (value(key) ? absoluteUrl(value(key)) : null)

    return {
      name: configValue('SITE_NAME') || value('site_name') || 'My BasicBen Blog',
      description: value('site_description'),
      url: siteUrl(),
      logo_url: image('site_logo'),
      icon_url: image('site_icon'),
      default_social_image_url: image('default_social_image'),
      accent_color: value('accent_color') || null,
      timezone: value('timezone') || SITE_DEFAULTS.timezone,
      locale: value('locale') || SITE_DEFAULTS.locale,
      code_injection: {
        head: value('code_injection_head'),
        foot: value('code_injection_foot')
      }
    }
  },

}
