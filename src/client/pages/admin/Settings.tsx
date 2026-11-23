import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface SiteSettings {
  site_name: string
  site_description: string
  posts_per_page: string
  allow_comments: string
  moderate_comments: string
  public_api: string
  webhook_urls: string
  robots_txt: string
  public_theme: string
  site_logo: string
  site_icon: string
  default_social_image: string
  timezone: string
  locale: string
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
  public_theme: '',
  site_logo: '',
  site_icon: '',
  default_social_image: '',
  timezone: 'UTC',
  locale: 'en',
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
  const [settings, setSettings] = useState<SiteSettings>(DEFAULTS)
  const [siteUrl, setSiteUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

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

    try {
      await api.put('/api/settings', { settings })
      setMessage('Settings saved successfully!')
    } catch (error: any) {
      // The server names the setting it refused; say which.
      setMessage(`Failed to save settings: ${error?.message || 'unknown error'}`)
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
      <AdminLayout title="Settings">
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Settings">
      <form onSubmit={handleSubmit}>
        {/* General Settings */}
        <div className="admin-card">
          <h3 className="admin-card-title">General</h3>

          <div className="admin-form-group">
            <label className="admin-label">Site Name</label>
            <input
              type="text"
              name="site_name"
              value={settings.site_name}
              onChange={handleChange}
              className="admin-input"
              placeholder="My Blog"
            />
          </div>

          <div className="admin-form-group">
            <label className="admin-label">Site Description</label>
            <textarea
              name="site_description"
              value={settings.site_description}
              onChange={handleChange}
              className="admin-textarea"
              style={{ minHeight: '80px' }}
              placeholder="A brief description of your site"
            />
          </div>
        </div>

        {/* Identity: what a front end shows in its header, tab and share cards. */}
        <div className="admin-card">
          <h3 className="admin-card-title">Site Identity</h3>

          <div className="admin-form-group">
            <label className="admin-label">Site URL</label>
            <input type="text" value={siteUrl} className="admin-input" readOnly disabled />
            <p style={hint}>
              Set by <code>SITE_URL</code> in the environment, not here. Feeds, the sitemap and
              <code> /api/v1/site</code> link to it.
            </p>
          </div>

          <div className="admin-form-group">
            <label className="admin-label">Logo URL</label>
            <input
              type="text"
              name="site_logo"
              value={settings.site_logo}
              onChange={handleChange}
              className="admin-input"
              placeholder="/uploads/logo.svg or https://…"
            />
          </div>

          <div className="admin-form-group">
            <label className="admin-label">Icon URL</label>
            <input
              type="text"
              name="site_icon"
              value={settings.site_icon}
              onChange={handleChange}
              className="admin-input"
              placeholder="/uploads/icon.png — favicon and app icon"
            />
          </div>

          <div className="admin-form-group">
            <label className="admin-label">Default Social Image URL</label>
            <input
              type="text"
              name="default_social_image"
              value={settings.default_social_image}
              onChange={handleChange}
              className="admin-input"
              placeholder="Used on share cards when a post or page has no image"
            />
            <p style={hint}>Paste a URL from the media library, or a path starting with /.</p>
          </div>
        </div>

        {/* Locale & time */}
        <div className="admin-card">
          <h3 className="admin-card-title">Language & Time</h3>

          <div className="admin-form-group">
            <label className="admin-label">Time Zone</label>
            <select name="timezone" value={settings.timezone} onChange={handleChange} className="admin-select">
              {!TIME_ZONES.includes(settings.timezone) && <option value={settings.timezone}>{settings.timezone}</option>}
              {TIME_ZONES.map(zone => <option key={zone} value={zone}>{zone}</option>)}
            </select>
            <p style={hint}>Dates are stored in UTC; this is the zone the front end shows them in.</p>
          </div>

          <div className="admin-form-group">
            <label className="admin-label">Locale</label>
            <input
              type="text"
              name="locale"
              value={settings.locale}
              onChange={handleChange}
              className="admin-input"
              placeholder="en, en-GB, fr-CA"
            />
            <p style={hint}>A BCP 47 language tag, for <code>&lt;html lang&gt;</code> and date formatting.</p>
          </div>
        </div>

        {/* Reading Settings */}
        <div className="admin-card">
          <h3 className="admin-card-title">Reading</h3>

          <div className="admin-form-group">
            <label className="admin-label">Posts Per Page</label>
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
            <label className="admin-label">robots.txt</label>
            <textarea
              name="robots_txt"
              value={settings.robots_txt}
              onChange={handleChange}
              className="admin-textarea"
              rows={5}
              placeholder={'Blank uses the default:\nUser-agent: *\nDisallow: /admin\nDisallow: /api/\nAllow: /api/v1/\nSitemap: …/sitemap.xml'}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px' }}
            />
          </div>
        </div>

        {/* The server-rendered reference theme. Off by default, so a site
            using its own front end (or the SPA) sees no change; the
            PUBLIC_THEME environment variable overrides this either way. */}
        <div className="admin-card">
          <h3 className="admin-card-title">Public site</h3>
          <div className="admin-form-group">
            <label className="admin-label" htmlFor="public_theme">Render the public site</label>
            <select id="public_theme" name="public_theme" value={settings.public_theme} onChange={handleChange} className="admin-input">
              <option value="">No — a separate front end (or the built-in app) renders it</option>
              <option value="ssr">Yes — with the built-in server-rendered theme</option>
            </select>
            <p style={hint}>
              Serves the home page, posts, pages, archives and custom content types as HTML from this app,
              with full SEO tags and oEmbed. Takes up to 30 seconds to apply.
            </p>
          </div>
        </div>

        {/* Discussion Settings */}
        <div className="admin-card">
          <h3 className="admin-card-title">Discussion</h3>

          <div className="admin-form-group">
            <label className="admin-label">Allow Comments</label>
            <select
              name="allow_comments"
              value={settings.allow_comments}
              onChange={handleChange}
              className="admin-select"
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>

          <div className="admin-form-group">
            <label className="admin-label">Moderate Comments</label>
            <select
              name="moderate_comments"
              value={settings.moderate_comments}
              onChange={handleChange}
              className="admin-select"
            >
              <option value="true">Yes - Require approval</option>
              <option value="false">No - Auto-approve all</option>
            </select>
            <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              If enabled, comments from guests will require approval before appearing.
            </p>
          </div>
        </div>

        {/* Headless API */}
        <div className="admin-card">
          <h3 className="admin-card-title">Headless API</h3>

          <div className="admin-form-group">
            <label className="admin-label">Public reads</label>
            <select
              name="public_api"
              value={settings.public_api}
              onChange={handleChange}
              className="admin-select"
            >
              <option value="false">No - /api/v1 requires a token</option>
              <option value="true">Yes - serve content to anyone</option>
            </select>
            <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Turning this on serves published content at <code>/api/v1</code> with no
              credential. Appropriate for a site whose content is public anyway, and for a
              browser-side consumer that cannot be trusted with a token.
            </p>
          </div>

          <div className="admin-form-group">
            <label className="admin-label">Webhook URLs</label>
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
              One per line. Each gets a POST when a post, page or media item is created, updated
              or deleted — which is what stops a consumer polling. Every request carries{' '}
              <code>X-BasicBen-Signature</code>, an HMAC of <code>X-BasicBen-Timestamp</code> and the exact body, keyed with your{' '}
              <code>WEBHOOK_SECRET</code> (set in the environment; nothing is sent without it); verify it over the <em>raw</em> body, since a parsed and
              re-serialised one will not match.
            </p>
            <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Delivery is at-most-once: a failure is logged and dropped, with no retry queue. A
              consumer that cannot miss an event should poll as a backstop.
            </p>
          </div>
        </div>

        {/* Code injection. Raw HTML, not sanitised — it exists to carry
            <script> tags — which is why only admins can reach this page. */}
        <div className="admin-card">
          <h3 className="admin-card-title">Code Injection</h3>
          <p style={{ ...hint, marginTop: 0, marginBottom: '1rem' }}>
            HTML your front end inserts verbatim on every page — analytics, verification tags,
            a font stylesheet. It is <strong>not sanitised</strong>: anything here runs on your site
            for every visitor. Served to the front end at <code>/api/v1/site</code>.
          </p>

          <div className="admin-form-group">
            <label className="admin-label">Site header (inside &lt;head&gt;)</label>
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
            <label className="admin-label">Site footer (before &lt;/body&gt;)</label>
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
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {message && (
            <span style={{ color: message.includes('Failed') ? 'var(--danger)' : 'var(--success)' }}>
              {message}
            </span>
          )}
        </div>
      </form>
    </AdminLayout>
  )
}
