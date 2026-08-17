import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface Plugin {
  name: string
  slug?: string
  version: string
  description?: string
  author?: string
  active: boolean
  hasUpdate?: boolean
  latestVersion?: string
}

interface RegistryPlugin {
  slug: string
  name: string
  version: string
  author?: string
  description?: string
  downloads?: number
  rating?: number
  icon?: string
  premium?: boolean
  installed?: boolean
}

/**
 * Whether the plugin registry is reachable.
 *
 * `registry.basicben.com` has not been built, so browse and install search a
 * host that does not resolve. Flip this to true when a registry exists — the
 * browse code, the API routes and the CLI commands are all still here.
 */
const REGISTRY_ENABLED = false

type Tab = 'installed' | 'browse'

export default function AdminPlugins() {
  const [tab, setTab] = useState<Tab>('installed')
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [registryPlugins, setRegistryPlugins] = useState<RegistryPlugin[]>([])
  const [loading, setLoading] = useState(true)
  const [browsing, setBrowsing] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null)

  useEffect(() => {
    loadPlugins()
  }, [])

  useEffect(() => {
    if (tab === 'browse') {
      browsePlugins()
    }
  }, [tab])

  // Debounced search
  useEffect(() => {
    if (tab === 'browse') {
      if (searchTimeout) clearTimeout(searchTimeout)
      const timeout = setTimeout(() => {
        browsePlugins(searchQuery)
      }, 300)
      setSearchTimeout(timeout)
      return () => clearTimeout(timeout)
    }
  }, [searchQuery])

  const loadPlugins = async () => {
    try {
      const res = await api.get<{ plugins: Plugin[] }>('/api/plugins')
      setPlugins(res?.plugins || [])
    } catch (error) {
      console.error('Failed to load plugins:', error)
    } finally {
      setLoading(false)
    }
  }

  const browsePlugins = async (search?: string) => {
    setBrowsing(true)
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : ''
      const res = await api.get<{ plugins: RegistryPlugin[] }>(`/api/registry/plugins${params}`)
      const installedSlugs = plugins.map(p => p.slug || p.name)

      setRegistryPlugins((res?.plugins || []).map((p: RegistryPlugin) => ({
        ...p,
        installed: installedSlugs.includes(p.slug)
      })))
    } catch (error) {
      console.error('Failed to browse plugins:', error)
      setRegistryPlugins([])
    } finally {
      setBrowsing(false)
    }
  }

  const handleToggle = async (name: string, currentlyActive: boolean) => {
    setToggling(name)

    try {
      if (currentlyActive) {
        await api.post('/api/plugins/deactivate', { name })
      } else {
        await api.post('/api/plugins/activate', { name })
      }

      setPlugins(plugins.map(p => ({
        ...p,
        active: p.name === name ? !currentlyActive : p.active
      })))

      alert(`Plugin ${currentlyActive ? 'deactivated' : 'activated'}. Restart the server to apply changes.`)
    } catch (error) {
      alert('Failed to toggle plugin')
    } finally {
      setToggling(null)
    }
  }

  const handleInstall = async (slug: string) => {
    if (!confirm(`Install plugin "${slug}"?`)) return

    setInstalling(slug)

    try {
      await api.post('/api/registry/plugins/install', { slug })
      alert(`Plugin "${slug}" installed successfully!`)

      // Refresh installed list
      await loadPlugins()

      // Mark as installed in registry list
      setRegistryPlugins(registryPlugins.map(p => ({
        ...p,
        installed: p.slug === slug ? true : p.installed
      })))
    } catch (error: any) {
      alert(error.message || 'Failed to install plugin')
    } finally {
      setInstalling(null)
    }
  }

  const renderStars = (rating: number = 0) => {
    const stars = []
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <span key={i} style={{ color: i <= rating ? 'var(--warning)' : 'var(--border-strong)' }}>
          ★
        </span>
      )
    }
    return stars
  }

  if (loading) {
    return (
      <AdminLayout title="Plugins">
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Plugins">
      <style>{pluginStyles}</style>

      {/*
        Browsing is hidden until a registry exists. The default registry host
        does not resolve, so the tab searched a dead address and reported an
        error — which reads as a broken feature rather than an absent one. The
        code behind it is untouched; set REGISTRY_ENABLED once there is
        something to talk to.
      */}
      {REGISTRY_ENABLED && (
        <div className="plugin-tabs">
          <button
            className={`plugin-tab ${tab === 'installed' ? 'active' : ''}`}
            onClick={() => setTab('installed')}
          >
            Installed ({plugins.length})
          </button>
          <button
            className={`plugin-tab ${tab === 'browse' ? 'active' : ''}`}
            onClick={() => setTab('browse')}
          >
            Browse Plugins
          </button>
        </div>
      )}

      {/* Installed Plugins Tab */}
      {tab === 'installed' && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Installed Plugins</h2>
          </div>

          {plugins.length === 0 ? (
            <div className="plugin-empty">
              <p>No plugins installed.</p>
              {REGISTRY_ENABLED ? (
                <button
                  onClick={() => setTab('browse')}
                  className="admin-btn admin-btn-primary"
                >
                  Browse Plugins
                </button>
              ) : (
                /* Pointing at the browse tab while it is hidden would be one
                   dead end replacing another. This is how plugins are actually
                   installed today. */
                <p style={{ color: 'var(--fg-muted)' }}>
                  Add one by putting a <code>.js</code> or <code>.ts</code> file in{' '}
                  <code>plugins/</code>, then run{' '}
                  <code>basicben plugin activate &lt;name&gt;</code> and restart.
                </p>
              )}
            </div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Plugin</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {plugins.map(plugin => (
                  <tr key={plugin.name}>
                    <td>
                      <div>
                        <strong>{plugin.name}</strong>
                        {plugin.description && (
                          <p style={{ margin: '0.25rem 0 0', color: 'var(--fg-muted)', fontSize: '0.875rem' }}>
                            {plugin.description}
                          </p>
                        )}
                        {plugin.author && (
                          <p style={{ margin: '0.25rem 0 0', color: 'var(--fg-subtle)', fontSize: '0.75rem' }}>
                            by {plugin.author}
                          </p>
                        )}
                      </div>
                    </td>
                    <td>
                      <span>v{plugin.version}</span>
                      {plugin.hasUpdate && (
                        <span className="admin-badge admin-badge-info" style={{ marginLeft: '0.5rem' }}>
                          Update: {plugin.latestVersion}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`admin-badge ${plugin.active ? 'admin-badge-success' : 'admin-badge-warning'}`}>
                        {plugin.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleToggle(plugin.name, plugin.active)}
                        className={`admin-btn ${plugin.active ? 'admin-btn-secondary' : 'admin-btn-primary'}`}
                        disabled={toggling === plugin.name}
                      >
                        {toggling === plugin.name
                          ? 'Processing...'
                          : (plugin.active ? 'Deactivate' : 'Activate')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Browse Plugins Tab */}
      {tab === 'browse' && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Plugin Registry</h2>
            <div className="plugin-search">
              <input
                type="text"
                placeholder="Search plugins..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="admin-input"
                style={{ width: '250px' }}
              />
            </div>
          </div>

          {browsing ? (
            <div className="plugin-loading">Searching plugins...</div>
          ) : registryPlugins.length === 0 ? (
            <div className="plugin-empty">
              <p>No plugins found. Try a different search.</p>
            </div>
          ) : (
            <div className="plugin-grid">
              {registryPlugins.map(plugin => (
                <div key={plugin.slug} className="plugin-card">
                  <div className="plugin-card-icon">
                    {plugin.icon ? (
                      <img src={plugin.icon} alt={plugin.name} />
                    ) : (
                      <span>🔌</span>
                    )}
                  </div>
                  <div className="plugin-card-content">
                    <h3 className="plugin-card-title">
                      {plugin.name}
                      {plugin.premium && (
                        <span className="admin-badge admin-badge-warning" style={{ marginLeft: '0.5rem' }}>
                          Premium
                        </span>
                      )}
                    </h3>
                    <div className="plugin-card-rating">
                      {renderStars(plugin.rating)}
                      {plugin.downloads && (
                        <span className="plugin-downloads">
                          {plugin.downloads.toLocaleString()} downloads
                        </span>
                      )}
                    </div>
                    <p className="plugin-card-description">
                      {plugin.description || 'No description available'}
                    </p>
                    <p className="plugin-card-meta">
                      v{plugin.version} {plugin.author && `by ${plugin.author}`}
                    </p>
                  </div>
                  <div className="plugin-card-actions">
                    {plugin.installed ? (
                      <span className="admin-badge admin-badge-success">Installed</span>
                    ) : (
                      <button
                        onClick={() => handleInstall(plugin.slug)}
                        className="admin-btn admin-btn-primary"
                        disabled={installing === plugin.slug}
                      >
                        {installing === plugin.slug ? 'Installing...' : 'Install'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  )
}

const pluginStyles = `
  .plugin-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .plugin-tab {
    padding: 0.75rem 1.5rem;
    background: white;
    border: 1px solid var(--border);
    border-radius: 0.5rem 0.5rem 0 0;
    cursor: pointer;
    font-weight: 500;
    color: var(--fg-muted);
  }

  .plugin-tab.active {
    background: white;
    border-bottom-color: white;
    color: var(--accent);
    margin-bottom: -1px;
    position: relative;
    z-index: 1;
  }

  .plugin-search {
    display: flex;
    gap: 0.5rem;
  }

  .plugin-empty {
    text-align: center;
    padding: 3rem;
    color: var(--fg-muted);
  }

  .plugin-loading {
    text-align: center;
    padding: 2rem;
    color: var(--fg-muted);
  }

  .plugin-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
  }

  .plugin-card {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 1rem;
    display: flex;
    gap: 1rem;
    transition: box-shadow 0.15s;
  }

  .plugin-card:hover {
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  .plugin-card-icon {
    width: 48px;
    height: 48px;
    background: var(--surface-hover);
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .plugin-card-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 0.5rem;
  }

  .plugin-card-content {
    flex: 1;
    min-width: 0;
  }

  .plugin-card-title {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
  }

  .plugin-card-rating {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }

  .plugin-downloads {
    color: var(--fg-muted);
    font-size: 0.75rem;
  }

  .plugin-card-description {
    color: var(--fg-muted);
    font-size: 0.875rem;
    margin: 0 0 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .plugin-card-meta {
    color: var(--fg-subtle);
    font-size: 0.75rem;
    margin: 0;
  }

  .plugin-card-actions {
    display: flex;
    align-items: flex-start;
    flex-shrink: 0;
  }
`
