import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api.ts'
import AdminLayout from '../../layouts/AdminLayout.tsx'
import { useT, ADMIN_LOCALES, applySiteLocale, slots } from '../../i18n/index.ts'
import { Slot } from '../../host/index.ts'
import { ConfigField, type ConfigStatus } from '../../components/admin/ConfigField.tsx'

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
  // Configuration the environment can also set (helpers/config.ts).
  site_url: string
  disable_registration: string
  image_transform_url: string
  storage_bucket: string
  storage_endpoint: string
  storage_region: string
  storage_public_url: string
  storage_access_key_id: string
  storage_secret_access_key: string
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
  code_injection_foot: '',
  site_url: '',
  disable_registration: 'false',
  image_transform_url: '',
  storage_bucket: '',
  storage_endpoint: '',
  storage_region: '',
  storage_public_url: '',
  storage_access_key_id: '',
  storage_secret_access_key: ''
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

/** The value in use for a configurable setting, when it is not secret. */
const configValueOf = (status?: ConfigStatus) => status?.value ?? ''

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
  // Where each configurable value comes from, and which secrets are saved.
  const [config, setConfig] = useState<ConfigStatus[]>([])
  const [secrets, setSecrets] = useState<Record<string, boolean>>({})
  const statusOf = (setting: string) => config.find((entry) => entry.setting === setting)
  const field = (name: keyof SiteSettings) => ({
    name,
    value: settings[name],
    onChange: (value: string) => setSettings(prev => ({ ...prev, [name]: value })),
    status: statusOf(name),
    saved: secrets[name]
  })

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const res = await api.get<{ settings: Partial<SiteSettings>; site_url?: string; config?: ConfigStatus[]; secrets?: Record<string, boolean> }>('/api/settings')
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
      setConfig(res?.config || [])
      setSecrets(res?.secrets || {})
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
      const saved = await api.put<{ config?: ConfigStatus[]; secrets?: Record<string, boolean> }>('/api/settings', { settings: { ...settings, ...extra } })
      // A secret is sent once: clear its field and show it as saved.
      const sent = new Set(Object.keys(saved?.secrets || {}))
      setSettings(prev => Object.fromEntries(Object.entries(prev).map(([key, value]) => [key, sent.has(key) ? '' : value])) as unknown as SiteSettings)
      setExtra(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => !sent.has(key))))
      if (saved?.config) setConfig(saved.config)
      if (saved?.secrets) setSecrets(saved.secrets)
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
              value={statusOf('site_name')?.locked_by ? statusOf('site_name')?.value ?? '' : settings.site_name}
              onChange={handleChange}
              className="admin-input"
              placeholder={t('My Blog')}
              disabled={Boolean(statusOf('site_name')?.locked_by)}
            />
            {statusOf('site_name')?.locked_by && (
              <p style={hint}>{slots(t('Set by {variable} in the environment, which wins over this setting.'), { variable: <code>{'SITE_NAME'}</code> })}</p>
            )}
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

          <ConfigField
            {...field('site_url')}
            label={t('Site URL')}
            placeholder={siteUrl}
            help={slots(t('The public site, if it is not this app. Feeds, the sitemap and {path} link to it. Blank uses APP_URL.'), { path: <code>{'/api/v1/site'}</code> })}
          />

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
        <Slot name="settings.reading" values={{ ...stored, ...extra }} config={config} secrets={secrets} onChange={(changes: Record<string, string>) => setExtra(prev => ({ ...prev, ...changes }))} />

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

        {/* Registration: DISABLE_REGISTRATION wins when set. */}
        <div className="admin-card">
          <h3 className="admin-card-title">{t('Registration')}</h3>

          <div className="admin-form-group">
            <label className="admin-label" htmlFor="disable_registration">{t('Who can create an account')}</label>
            <select
              id="disable_registration"
              name="disable_registration"
              value={statusOf('disable_registration')?.locked_by ? (configValueOf(statusOf('disable_registration')) === 'true' ? 'true' : 'false') : settings.disable_registration}
              onChange={handleChange}
              className="admin-select"
              disabled={Boolean(statusOf('disable_registration')?.locked_by)}
            >
              <option value="false">{t('Anyone, from the sign-up page')}</option>
              <option value="true">{t('Only people you invite from Users')}</option>
            </select>
            <p style={hint}>
              {statusOf('disable_registration')?.locked_by
                ? slots(t('Set by {variable} in the environment, which wins over this setting.'), { variable: <code>{'DISABLE_REGISTRATION'}</code> })
                : t('The first account can always be created, so a new site can make its admin.')}
            </p>
          </div>
        </div>

        {/* Media storage: the S3_* variables, as settings. S3_BUCKET locks them all. */}
        <div className="admin-card">
          <h3 className="admin-card-title">{t('Media Storage')}</h3>
          <p style={{ ...hint, marginTop: 0, marginBottom: '1rem' }}>
            {statusOf('storage_bucket')?.locked_by
              ? slots(t('Storage is configured by {variable} and the other S3 variables in the environment, which win over these settings.'), { variable: <code>{'S3_BUCKET'}</code> })
              : t('Any S3-compatible bucket: Cloudflare R2, AWS S3, Backblaze B2, MinIO. Without one, uploads go to this server\'s disk, which serverless hosts do not keep.')}
          </p>

          <ConfigField {...field('storage_bucket')} label={t('Bucket')} />
          <ConfigField {...field('storage_endpoint')} label={t('Endpoint')} placeholder={'https://<account-id>.r2.cloudflarestorage.com'} help={t('Blank for AWS S3.')} />
          <ConfigField {...field('storage_region')} label={t('Region')} placeholder={'auto'} help={t('auto for R2; the bucket\'s region for AWS S3.')} />
          <ConfigField {...field('storage_public_url')} label={t('Public URL')} placeholder={'https://media.example.com'} help={t('Where the files are served from: a custom domain or CDN in front of the bucket.')} />
          <ConfigField {...field('storage_access_key_id')} label={t('Access key ID')} />
          <ConfigField {...field('storage_secret_access_key')} label={t('Secret access key')} help={t('Stored encrypted with APP_KEY and never shown again.')} />

          <ConfigField
            {...field('image_transform_url')}
            label={t('Image transform URL')}
            placeholder={'https://example.com/cdn-cgi/image/width={width}/{url}'}
            help={t('Optional. A resizing service template with {url} and {width}, so images get a srcset.')}
          />
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
