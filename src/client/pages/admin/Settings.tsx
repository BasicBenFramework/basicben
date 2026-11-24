import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import { useT, ADMIN_LOCALES, applySiteLocale, slots } from '../../i18n'
import { Slot } from '../../host'

interface SiteSettings {
  site_name: string
  site_description: string
  posts_per_page: string
  allow_comments: string
  moderate_comments: string
  public_api: string
  webhook_urls: string
  robots_txt: string
  site_logo: string
  site_icon: string
  default_social_image: string
  timezone: string
  locale: string
  admin_locale: string
  code_injection_head: string
  code_injection_foot: string
}

const DEFAULTS: SiteSettings = {
  site_name: '',
  site_description: '',
  posts_per_page: '10',
  allow_comments: 'true',
  moderate_comments: 'true',
  public_api: 'false',
  webhook_urls: '',
  robots_txt: '',
  site_logo: '',
  site_icon: '',
  default_social_image: '',
  timezone: 'UTC',
  locale: 'en',
  admin_locale: '',
  code_injection_head: '',
  code_injection_foot: ''
}

// The zones the runtime knows, for the picker. The server validates against
// the same Intl data, so anything offered here is accepted there.
const TIME_ZONES: string[] = (() => {
  try {
    return ['UTC', ...(Intl as any).supportedValuesOf('timeZone').filter((z: string) => z !== 'UTC')]
  } catch {
    return ['UTC']
  }
})()

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px' }
const hint = { color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }

export default function AdminSettings() {
  const { t } = useT()
  const [settings, setSettings] = useState<SiteSettings>(DEFAULTS)
  const [siteUrl, setSiteUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  // Every stored setting, for features' sections, and what they changed.
  const [stored, setStored] = useState<Record<string, string>>({})
  const [extra, setExtra] = useState<Record<string, string>>({})

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const res = await api.get<{ settings: Partial<SiteSettings>; site_url?: string }>('/api/settings')
      if (res?.settings) {
        // Only the known keys, each falling back to its default: the response
        // can also carry legacy rows the form has no field for, and sending
        // those back would be refused as unknown settings.
        const loaded = { ...DEFAULTS }
        for (const key of Object.keys(DEFAULTS) as Array<keyof SiteSettings>) {
          if (res.settings[key]) loaded[key] = res.settings[key] as string
        }
        setSettings(loaded)
        setStored(Object.fromEntries(Object.entries(res.settings).map(([key, value]) => [key, String(value ?? '')])))
      }
      setSiteUrl(res?.site_url || '')
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage('')
    setFailed(false)

    try {
      await api.put('/api/settings', { settings: { ...settings, ...extra } })
      // The admin's own language may have just changed; show it now.
      await applySiteLocale(settings.admin_locale)
      setMessage(t('Settings saved successfully!'))
    } catch (error: any) {
      // The server names the setting it refused; say which.
      setFailed(true)
      setMessage(t('Failed to save settings: {error}', { error: error?.message || t('unknown error') }))
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setSettings(prev => ({ ...prev, [name]: value }))
  }

  if (loading) {
    return (
      <AdminLayout title={t('Settings')}>
        <div className="admin-loading">{t('Loading...')}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={t('Settings')}>
      <form onSubmit={handleSubmit}>
        {/* General Settings */}
        <div className="admin-card">
          <h3 className="admin-card-title">{t('General')}</h3>

          <div className="admin-form-group">
            <label className="admin-label">{t('Site Name')}</label>
            <input
              type="text"
              name="site_name"
              value={settings.site_name}
              onChange={handleChange}
              className="admin-input"
              placeholder={t('My Blog')}
            />
          </div>

          <div className="admin-form-group">
            <label className="admin-label">{t('Site Description')}</label>
            <textarea
              name="site_description"
              value={settings.site_description}
              onChange={handleChange}
              className="admin-textarea"
              style={{ minHeight: '80px' }}
              placeholder={t('A brief description of your site')}
            />
          </div>
        </div>

        {/* Identity: what a front end shows in its header, tab and share cards. */}
        <div className="admin-card">
          <h3 className="admin-card-title">{t('Site Identity')}</h3>

          <div className="admin-form-group">
            <label className="admin-label">{t('Site URL')}</label>
            <input type="text" value={siteUrl} className="admin-input" readOnly disabled />
            <p style={hint}>
              {slots(t('Set by {variable} in the environment, not here. Feeds, the sitemap and {path} link to it.'), { variable: <code>{'SITE_URL'}</code>, path: <code>{'/api/v1/site'}</code> })}
            </p>
          </div>

          <div className="admin-form-group">
            <label className="admin-label">{t('Logo URL')}</label>
            <input
              type="text"
              name="site_logo"
              value={settings.site_logo}
              onChange={handleChange}
              className="admin-input"
              placeholder={t('/uploads/logo.svg or https://…')}
            />
          </div>

          <div className="admin-form-group">
            <label className="admin-label">{t('Icon URL')}</label>
            <input
              type="text"
              name="site_icon"
              value={settings.site_icon}
              onChange={handleChange}
              className="admin-input"
              placeholder={t('/uploads/icon.png — favicon and app icon')}
            />
          </div>

          <div className="admin-form-group">
            <label className="admin-label">{t('Default Social Image URL')}</label>
            <input
              type="text"
              name="default_social_image"
              value={settings.default_social_image}
              onChange={handleChange}
              className="admin-input"
              placeholder={t('Used on share cards when a post or page has no image')}
            />
            <p style={hint}>{t('Paste a URL from the media library, or a path starting with /.')}</p>
          </div>
        </div>

        {/* Locale & time */}
        <div className="admin-card">
          <h3 className="admin-card-title">{t('Language & Time')}</h3>

          <div className="admin-form-group">
            <label className="admin-label">{t('Time Zone')}</label>
            <select name="timezone" value={settings.timezone} onChange={handleChange} className="admin-select">
              {!TIME_ZONES.includes(settings.timezone) && <option value={settings.timezone}>{settings.timezone}</option>}
              {TIME_ZONES.map(zone => <option key={zone} value={zone}>{zone}</option>)}
            </select>
            <p style={hint}>{t('Dates are stored in UTC; this is the zone the front end shows them in.')}</p>
          </div>

          <div className="admin-form-group">
            <label className="admin-label">{t('Locale')}</label>
            <input
              type="text"
              name="locale"
              value={settings.locale}
              onChange={handleChange}
              className="admin-input"
              placeholder={t('en, en-GB, fr-CA')}
            />
            <p style={hint}>{slots(t('A BCP 47 language tag, for {tag} and date formatting.'), { tag: <code>{'<html lang>'}</code> })}</p>
          </div>

          <div className="admin-form-group">
            <label className="admin-label" htmlFor="admin_locale">{t('Admin language')}</label>
            <select id="admin_locale" name="admin_locale" value={settings.admin_locale || 'en'} onChange={handleChange} className="admin-select">
              {ADMIN_LOCALES.map(option => <option key={option.code} value={option.code}>{option.name}</option>)}
            </select>
            <p style={hint}>{t('The admin\'s language for everyone who has not chosen one in their profile.')}</p>
          </div>
        </div>

        {/* Reading Settings */}
        <div className="admin-card">
          <h3 className="admin-card-title">{t('Reading')}</h3>

          <div className="admin-form-group">
            <label className="admin-label">{t('Posts Per Page')}</label>
            <input
              type="number"
              name="posts_per_page"
              value={settings.posts_per_page}
              onChange={handleChange}
              className="admin-input"
              min="1"
              max="100"
            />
          </div>

          {/* Served at /robots.txt. Blank serves a default that points at the
              sitemap and keeps crawlers out of the admin and the API. */}
          <div className="admin-form-group">
            <label className="admin-label">{'robots.txt'}</label>
            <textarea
              name="robots_txt"
              value={settings.robots_txt}
              onChange={handleChange}
              className="admin-textarea"
              rows={5}
              placeholder={t('Blank uses the default:') + '\nUser-agent: *\nDisallow: /admin\nDisallow: /api/\nAllow: /api/v1/\nSitemap: …/sitemap.xml'}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px' }}
            />
          </div>
        </div>

        {/* Features' settings that belong with reading, such as the theme's
            "render the public site". Saved with the rest of the form. */}
        <Slot name="settings.reading" values={{ ...stored, ...extra }} onChange={(changes: Record<string, string>) => setExtra(prev => ({ ...prev, ...changes }))} />

        {/* Discussion Settings */}
        <div className="admin-card">
          <h3 className="admin-card-title">{t('Discussion')}</h3>

          <div className="admin-form-group">
            <label className="admin-label">{t('Allow Comments')}</label>
            <select
              name="allow_comments"
              value={settings.allow_comments}
              onChange={handleChange}
              className="admin-select"
            >
              <option value="true">{t('Yes')}</option>
              <option value="false">{t('No')}</option>
            </select>
          </div>

          <div className="admin-form-group">
            <label className="admin-label">{t('Moderate Comments')}</label>
            <select
              name="moderate_comments"
              value={settings.moderate_comments}
              onChange={handleChange}
              className="admin-select"
            >
              <option value="true">{t('Yes - Require approval')}</option>
              <option value="false">{t('No - Auto-approve all')}</option>
            </select>
            <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              {t('If enabled, comments from guests will require approval before appearing.')}
            </p>
          </div>
        </div>

        {/* Headless API */}
        <div className="admin-card">
          <h3 className="admin-card-title">{t('Headless API')}</h3>

          <div className="admin-form-group">
            <label className="admin-label">{t('Public reads')}</label>
            <select
              name="public_api"
              value={settings.public_api}
              onChange={handleChange}
              className="admin-select"
            >
              <option value="false">{t('No - /api/v1 requires a token')}</option>
              <option value="true">{t('Yes - serve content to anyone')}</option>
            </select>
            <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              {slots(t('Turning this on serves published content at {path} with no credential. Appropriate for a site whose content is public anyway, and for a browser-side consumer that cannot be trusted with a token.'), { path: <code>{'/api/v1'}</code> })}
            </p>
          </div>

          <div className="admin-form-group">
            <label className="admin-label">{t('Webhook URLs')}</label>
            <textarea
              name="webhook_urls"
              value={settings.webhook_urls}
              onChange={handleChange}
              className="admin-input"
              rows={4}
              placeholder={'https://example.com/rebuild\nhttps://another.example.com/hook'}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px' }}
            />
            <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              {slots(t('One per line. Each gets a POST when a post, page or media item is created, updated or deleted — which is what stops a consumer polling. Every request carries {signature}, an HMAC of {timestamp} and the exact body, keyed with your {secret} (set in the environment; nothing is sent without it); verify it over the {raw} body, since a parsed and re-serialised one will not match.'), {
                signature: <code>{'X-BasicBen-Signature'}</code>,
                timestamp: <code>{'X-BasicBen-Timestamp'}</code>,
                secret: <code>{'WEBHOOK_SECRET'}</code>,
                raw: <em>{t('raw')}</em>
              })}
            </p>
            <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              {t('Delivery is at-most-once: a failure is logged and dropped, with no retry queue. A consumer that cannot miss an event should poll as a backstop.')}
            </p>
          </div>
        </div>

        {/* Code injection. Raw HTML, not sanitised — it exists to carry
            <script> tags — which is why only admins can reach this page. */}
        <div className="admin-card">
          <h3 className="admin-card-title">{t('Code Injection')}</h3>
          <p style={{ ...hint, marginTop: 0, marginBottom: '1rem' }}>
            {slots(t('HTML your front end inserts verbatim on every page — analytics, verification tags, a font stylesheet. It is {warning}: anything here runs on your site for every visitor. Served to the front end at {path}.'), {
              warning: <strong>{t('not sanitised')}</strong>,
              path: <code>{'/api/v1/site'}</code>
            })}
          </p>

          <div className="admin-form-group">
            <label className="admin-label">{t('Site header (inside {tag})', { tag: '<head>' })}</label>
            <textarea
              name="code_injection_head"
              value={settings.code_injection_head}
              onChange={handleChange}
              className="admin-textarea"
              rows={6}
              style={mono}
            />
          </div>

          <div className="admin-form-group">
            <label className="admin-label">{t('Site footer (before {tag})', { tag: '</body>' })}</label>
            <textarea
              name="code_injection_foot"
              value={settings.code_injection_foot}
              onChange={handleChange}
              className="admin-textarea"
              rows={6}
              style={mono}
            />
          </div>
        </div>

        {/* Save Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            type="submit"
            className="admin-btn admin-btn-primary"
            disabled={saving}
          >
            {saving ? t('Saving...') : t('Save Settings')}
          </button>
          {message && (
            <span style={{ color: failed ? 'var(--danger)' : 'var(--success)' }}>
              {message}
            </span>
          )}
        </div>
      </form>
    </AdminLayout>
  )
}
