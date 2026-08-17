import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface CoreUpdate {
  current: string
  latest: string
  available: boolean
  channel: string
  changelog?: string
  releaseDate?: string
}

interface PluginUpdate {
  name: string
  slug: string
  current: string
  latest: string
  changelog?: string
}

interface UpdateCheck {
  core: CoreUpdate
  plugins: PluginUpdate[]
  lastChecked: string
}

export default function AdminUpdates() {
  const [updates, setUpdates] = useState<UpdateCheck | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [showChangelog, setShowChangelog] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    checkUpdates()
  }, [])

  const checkUpdates = async (force = false) => {
    setChecking(true)
    setError(null)

    try {
      const res = await api.get<UpdateCheck>('/api/updates/check' + (force ? '?force=true' : ''))
      setUpdates(res)
    } catch (err: any) {
      setError(err.message || 'Failed to check for updates')
    } finally {
      setChecking(false)
      setLoading(false)
    }
  }

  const handleCoreUpdate = async () => {
    if (!updates?.core.available) return
    if (!confirm('Update BasicBen core? A backup will be created automatically.')) return

    setUpdating('core')
    setError(null)

    try {
      await api.post('/api/updates/core', {
        version: updates.core.latest
      })

      alert('Core updated successfully! Please restart the server.')
      checkUpdates(true)
    } catch (err: any) {
      setError(err.message || 'Failed to update core')
    } finally {
      setUpdating(null)
    }
  }

  const handlePluginUpdate = async (slug: string) => {
    if (!confirm(`Update plugin "${slug}"?`)) return

    setUpdating(`plugin:${slug}`)
    setError(null)

    try {
      await api.post(`/api/updates/plugins/${slug}`)
      alert('Plugin updated successfully!')
      checkUpdates(true)
    } catch (err: any) {
      setError(err.message || 'Failed to update plugin')
    } finally {
      setUpdating(null)
    }
  }

  const handleUpdateAll = async () => {
    const pluginCount = updates?.plugins.length || 0

    if (pluginCount === 0) return

    if (!confirm(`Update ${pluginCount} plugins?`)) return

    setUpdating('all')
    setError(null)

    try {
      // Update plugins
      for (const plugin of updates?.plugins || []) {
        await api.post(`/api/updates/plugins/${plugin.slug}`)
      }

      alert('All updates applied successfully!')
      checkUpdates(true)
    } catch (err: any) {
      setError(err.message || 'Failed to update all')
    } finally {
      setUpdating(null)
    }
  }

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString()
    } catch {
      return dateStr
    }
  }

  if (loading) {
    return (
      <AdminLayout title="Updates">
        <div className="admin-loading">Checking for updates...</div>
      </AdminLayout>
    )
  }

  const hasPluginUpdates = (updates?.plugins.length || 0) > 0
  const totalUpdates = (updates?.core.available ? 1 : 0) +
    (updates?.plugins.length || 0)

  return (
    <AdminLayout title="Updates">
      <style>{updatesStyles}</style>

      {/* Error Alert */}
      {error && (
        <div className="updates-alert updates-alert-error">
          <span>Error: {error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Header with Check Button */}
      <div className="updates-header">
        <div>
          <h2 className="updates-title">System Updates</h2>
          <p className="updates-subtitle">
            {totalUpdates === 0
              ? 'Everything is up to date!'
              : `${totalUpdates} update${totalUpdates > 1 ? 's' : ''} available`}
          </p>
        </div>
        <button
          onClick={() => checkUpdates(true)}
          className="admin-btn admin-btn-secondary"
          disabled={checking}
        >
          {checking ? 'Checking...' : 'Check Now'}
        </button>
      </div>

      {/* Core Update */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h3 className="admin-card-title">BasicBen Core</h3>
        </div>

        {updates?.core.available ? (
          <div className="updates-core-available">
            <div className="updates-core-icon">
              <span>⬆️</span>
            </div>
            <div className="updates-core-info">
              <h4>Update Available</h4>
              <p>
                Current: <strong>{updates.core.current}</strong>
                {' → '}
                Latest: <strong>{updates.core.latest}</strong>
              </p>
              {updates.core.releaseDate && (
                <p className="updates-release-date">
                  Released: {formatDate(updates.core.releaseDate)}
                </p>
              )}

              {updates.core.changelog && (
                <div className="updates-changelog">
                  <button
                    onClick={() => setShowChangelog(showChangelog === 'core' ? null : 'core')}
                    className="updates-changelog-toggle"
                  >
                    {showChangelog === 'core' ? 'Hide' : 'View'} Changelog
                  </button>

                  {showChangelog === 'core' && (
                    <div className="updates-changelog-content">
                      <pre>{updates.core.changelog}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="updates-core-actions">
              <button
                onClick={handleCoreUpdate}
                className="admin-btn admin-btn-primary"
                disabled={updating === 'core'}
              >
                {updating === 'core' ? 'Updating...' : 'Update Now'}
              </button>
            </div>
          </div>
        ) : (
          <div className="updates-core-latest">
            <span className="updates-check-icon">✓</span>
            <div>
              <p><strong>BasicBen {updates?.core.current}</strong></p>
              <p className="updates-subtitle">You're running the latest version</p>
            </div>
          </div>
        )}
      </div>

      {/* Plugin Updates */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h3 className="admin-card-title">Plugins</h3>
          {hasPluginUpdates && (
            <button
              onClick={() => {
                for (const plugin of updates?.plugins || []) {
                  handlePluginUpdate(plugin.slug)
                }
              }}
              className="admin-btn admin-btn-secondary"
              disabled={updating !== null}
            >
              Update All ({updates?.plugins.length})
            </button>
          )}
        </div>

        {hasPluginUpdates ? (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Plugin</th>
                <th>Current</th>
                <th>Latest</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {updates?.plugins.map(plugin => (
                <tr key={plugin.slug}>
                  <td>
                    <strong>{plugin.name}</strong>
                  </td>
                  <td>{plugin.current}</td>
                  <td>
                    <span className="admin-badge admin-badge-info">{plugin.latest}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {plugin.changelog && (
                        <button
                          onClick={() => setShowChangelog(
                            showChangelog === `plugin:${plugin.slug}` ? null : `plugin:${plugin.slug}`
                          )}
                          className="admin-btn admin-btn-secondary"
                        >
                          Changelog
                        </button>
                      )}
                      <button
                        onClick={() => handlePluginUpdate(plugin.slug)}
                        className="admin-btn admin-btn-primary"
                        disabled={updating === `plugin:${plugin.slug}`}
                      >
                        {updating === `plugin:${plugin.slug}` ? 'Updating...' : 'Update'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="updates-empty">
            <span className="updates-check-icon">✓</span>
            <p>All plugins are up to date</p>
          </div>
        )}
      </div>

      {/* Last Checked */}
      {updates?.lastChecked && (
        <p className="updates-last-checked">
          Last checked: {formatDate(updates.lastChecked)}
        </p>
      )}
    </AdminLayout>
  )
}

const updatesStyles = `
  .updates-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .updates-title {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 0.25rem;
  }

  .updates-subtitle {
    color: #6b7280;
    margin: 0;
  }

  .updates-alert {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .updates-alert-error {
    background-color: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  .updates-alert button {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
  }

  .updates-core-available {
    display: flex;
    gap: 1.5rem;
    padding: 1rem;
    background-color: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 0.5rem;
  }

  .updates-core-icon {
    font-size: 2.5rem;
  }

  .updates-core-info {
    flex: 1;
  }

  .updates-core-info h4 {
    margin: 0 0 0.5rem;
    font-size: 1.125rem;
  }

  .updates-core-info p {
    margin: 0 0 0.25rem;
    color: #374151;
  }

  .updates-release-date {
    font-size: 0.875rem;
    color: #6b7280 !important;
  }

  .updates-core-actions {
    display: flex;
    align-items: center;
  }

  .updates-core-latest {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
  }

  .updates-check-icon {
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #d1fae5;
    color: #065f46;
    border-radius: 50%;
    font-size: 1.25rem;
    font-weight: bold;
  }

  .updates-empty {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.5rem;
    color: #6b7280;
  }

  .updates-empty .updates-check-icon {
    width: 2rem;
    height: 2rem;
    font-size: 1rem;
  }

  .updates-changelog {
    margin-top: 0.75rem;
  }

  .updates-changelog-toggle {
    background: none;
    border: none;
    color: #4f46e5;
    cursor: pointer;
    padding: 0;
    font-size: 0.875rem;
  }

  .updates-changelog-toggle:hover {
    text-decoration: underline;
  }

  .updates-changelog-content {
    margin-top: 0.75rem;
    padding: 1rem;
    background-color: #f9fafb;
    border-radius: 0.375rem;
    overflow-x: auto;
  }

  .updates-changelog-content pre {
    margin: 0;
    white-space: pre-wrap;
    font-size: 0.875rem;
    font-family: inherit;
  }

  .updates-last-checked {
    text-align: center;
    color: #9ca3af;
    font-size: 0.875rem;
    margin-top: 1.5rem;
  }
`
