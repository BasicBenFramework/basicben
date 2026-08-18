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
}

export default function AdminSettings() {
  const [settings, setSettings] = useState<SiteSettings>({
    site_name: '',
    site_description: '',
    posts_per_page: '10',
    allow_comments: 'true',
    moderate_comments: 'true',
    public_api: 'false',
    webhook_urls: ''
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const res = await api.get<{ settings: Partial<SiteSettings> }>('/api/settings')
      if (res?.settings) {
        setSettings({
          site_name: res.settings.site_name || '',
          site_description: res.settings.site_description || '',
          posts_per_page: res.settings.posts_per_page || '10',
          allow_comments: res.settings.allow_comments || 'true',
          moderate_comments: res.settings.moderate_comments || 'true',
          public_api: res.settings.public_api || 'false',
          webhook_urls: res.settings.webhook_urls || ''
        })
      }
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
    } catch (error) {
      setMessage('Failed to save settings')
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
              <code>X-BasicBen-Signature</code>, an HMAC of the exact body keyed with your{' '}
              <code>APP_KEY</code>; verify it over the <em>raw</em> body, since a parsed and
              re-serialised one will not match.
            </p>
            <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Delivery is at-most-once: a failure is logged and dropped, with no retry queue. A
              consumer that cannot miss an event should poll as a backstop.
            </p>
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
