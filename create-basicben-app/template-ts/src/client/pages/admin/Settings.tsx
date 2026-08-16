import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface SiteSettings {
  site_name: string
  site_description: string
  posts_per_page: string
  allow_comments: string
  moderate_comments: string
}

export default function AdminSettings() {
  const [settings, setSettings] = useState<SiteSettings>({
    site_name: '',
    site_description: '',
    posts_per_page: '10',
    allow_comments: 'true',
    moderate_comments: 'true'
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
          moderate_comments: res.settings.moderate_comments || 'true'
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
            <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              If enabled, comments from guests will require approval before appearing.
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
            <span style={{ color: message.includes('Failed') ? '#ef4444' : '#22c55e' }}>
              {message}
            </span>
          )}
        </div>
      </form>
    </AdminLayout>
  )
}
