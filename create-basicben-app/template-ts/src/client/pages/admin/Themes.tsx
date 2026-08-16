import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface Theme {
  slug: string
  name: string
  version: string
  description?: string
  author?: string
  screenshot?: string
  active: boolean
  hasUpdate?: boolean
  latestVersion?: string
}

interface RegistryTheme {
  slug: string
  name: string
  version: string
  author?: string
  description?: string
  downloads?: number
  rating?: number
  screenshot?: string
  premium?: boolean
  installed?: boolean
}

type Tab = 'installed' | 'browse'

export default function AdminThemes() {
  const [tab, setTab] = useState<Tab>('installed')
  const [themes, setThemes] = useState<Theme[]>([])
  const [registryThemes, setRegistryThemes] = useState<RegistryTheme[]>([])
  const [loading, setLoading] = useState(true)
  const [browsing, setBrowsing] = useState(false)
  const [activating, setActivating] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null)

  useEffect(() => {
    loadThemes()
  }, [])

  useEffect(() => {
    if (tab === 'browse') {
      browseThemes()
    }
  }, [tab])

  // Debounced search
  useEffect(() => {
    if (tab === 'browse') {
      if (searchTimeout) clearTimeout(searchTimeout)
      const timeout = setTimeout(() => {
        browseThemes(searchQuery)
      }, 300)
      setSearchTimeout(timeout)
      return () => clearTimeout(timeout)
    }
  }, [searchQuery])

  const loadThemes = async () => {
    try {
      const res = await api.get<{ themes: Theme[] }>('/api/themes')
      setThemes(res?.themes || [])
    } catch (error) {
      console.error('Failed to load themes:', error)
    } finally {
      setLoading(false)
    }
  }

  const browseThemes = async (search?: string) => {
    setBrowsing(true)
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : ''
      const res = await api.get<{ themes: RegistryTheme[] }>(`/api/registry/themes${params}`)
      const installedSlugs = themes.map(t => t.slug)

      setRegistryThemes((res?.themes || []).map((t: RegistryTheme) => ({
        ...t,
        installed: installedSlugs.includes(t.slug)
      })))
    } catch (error) {
      console.error('Failed to browse themes:', error)
      setRegistryThemes([])
    } finally {
      setBrowsing(false)
    }
  }

  const handleActivate = async (slug: string) => {
    setActivating(slug)

    try {
      await api.post('/api/themes/activate', { slug })
      setThemes(themes.map(t => ({
        ...t,
        active: t.slug === slug
      })))
    } catch (error) {
      alert('Failed to activate theme')
    } finally {
      setActivating(null)
    }
  }

  const handleInstall = async (slug: string) => {
    if (!confirm(`Install theme "${slug}"?`)) return

    setInstalling(slug)

    try {
      await api.post('/api/registry/themes/install', { slug })
      alert(`Theme "${slug}" installed successfully!`)

      // Refresh installed list
      await loadThemes()

      // Mark as installed in registry list
      setRegistryThemes(registryThemes.map(t => ({
        ...t,
        installed: t.slug === slug ? true : t.installed
      })))
    } catch (error: any) {
      alert(error.message || 'Failed to install theme')
    } finally {
      setInstalling(null)
    }
  }

  const renderStars = (rating: number = 0) => {
    const stars = []
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <span key={i} style={{ color: i <= rating ? '#f59e0b' : '#d1d5db' }}>
          ★
        </span>
      )
    }
    return stars
  }

  if (loading) {
    return (
      <AdminLayout title="Themes">
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Themes">
      <style>{themeStyles}</style>

      {/* Tabs */}
      <div className="theme-tabs">
        <button
          className={`theme-tab ${tab === 'installed' ? 'active' : ''}`}
          onClick={() => setTab('installed')}
        >
          Installed ({themes.length})
        </button>
        <button
          className={`theme-tab ${tab === 'browse' ? 'active' : ''}`}
          onClick={() => setTab('browse')}
        >
          Browse Themes
        </button>
      </div>

      {/* Installed Themes Tab */}
      {tab === 'installed' && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Installed Themes</h2>
          </div>

          {themes.length === 0 ? (
            <div className="theme-empty">
              <p>No themes installed.</p>
              <button
                onClick={() => setTab('browse')}
                className="admin-btn admin-btn-primary"
              >
                Browse Themes
              </button>
            </div>
          ) : (
            <div className="admin-grid admin-grid-3">
              {themes.map(theme => (
                <div
                  key={theme.slug}
                  className={`theme-card ${theme.active ? 'theme-card-active' : ''}`}
                >
                  {/* Screenshot */}
                  <div className="theme-screenshot">
                    {theme.screenshot ? (
                      <img
                        src={theme.screenshot}
                        alt={theme.name}
                      />
                    ) : (
                      <span className="theme-screenshot-placeholder">🎨</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="theme-info">
                    <div className="theme-header">
                      <h3 className="theme-name">{theme.name}</h3>
                      {theme.active && (
                        <span className="admin-badge admin-badge-success">Active</span>
                      )}
                      {theme.hasUpdate && (
                        <span className="admin-badge admin-badge-info">Update</span>
                      )}
                    </div>

                    <p className="theme-description">
                      {theme.description || 'No description'}
                    </p>

                    <p className="theme-meta">
                      v{theme.version} {theme.author && `by ${theme.author}`}
                    </p>

                    <div className="theme-actions">
                      {!theme.active && (
                        <button
                          onClick={() => handleActivate(theme.slug)}
                          className="admin-btn admin-btn-primary"
                          disabled={activating === theme.slug}
                        >
                          {activating === theme.slug ? 'Activating...' : 'Activate'}
                        </button>
                      )}
                      <a
                        href={`/admin/themes/${theme.slug}/customize`}
                        className="admin-btn admin-btn-secondary"
                      >
                        Customize
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Browse Themes Tab */}
      {tab === 'browse' && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Theme Registry</h2>
            <div className="theme-search">
              <input
                type="text"
                placeholder="Search themes..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="admin-input"
                style={{ width: '250px' }}
              />
            </div>
          </div>

          {browsing ? (
            <div className="theme-loading">Searching themes...</div>
          ) : registryThemes.length === 0 ? (
            <div className="theme-empty">
              <p>No themes found. Try a different search.</p>
            </div>
          ) : (
            <div className="admin-grid admin-grid-3">
              {registryThemes.map(theme => (
                <div key={theme.slug} className="theme-card">
                  {/* Screenshot */}
                  <div className="theme-screenshot">
                    {theme.screenshot ? (
                      <img src={theme.screenshot} alt={theme.name} />
                    ) : (
                      <span className="theme-screenshot-placeholder">🎨</span>
                    )}
                    {theme.premium && (
                      <span className="theme-premium-badge">Premium</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="theme-info">
                    <div className="theme-header">
                      <h3 className="theme-name">{theme.name}</h3>
                    </div>

                    <div className="theme-rating">
                      {renderStars(theme.rating)}
                      {theme.downloads && (
                        <span className="theme-downloads">
                          {theme.downloads.toLocaleString()} downloads
                        </span>
                      )}
                    </div>

                    <p className="theme-description">
                      {theme.description || 'No description available'}
                    </p>

                    <p className="theme-meta">
                      v{theme.version} {theme.author && `by ${theme.author}`}
                    </p>

                    <div className="theme-actions">
                      {theme.installed ? (
                        <span className="admin-badge admin-badge-success">Installed</span>
                      ) : (
                        <button
                          onClick={() => handleInstall(theme.slug)}
                          className="admin-btn admin-btn-primary"
                          disabled={installing === theme.slug}
                        >
                          {installing === theme.slug ? 'Installing...' : 'Install'}
                        </button>
                      )}
                    </div>
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

const themeStyles = `
  .theme-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .theme-tab {
    padding: 0.75rem 1.5rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem 0.5rem 0 0;
    cursor: pointer;
    font-weight: 500;
    color: #6b7280;
  }

  .theme-tab.active {
    background: white;
    border-bottom-color: white;
    color: #4f46e5;
    margin-bottom: -1px;
    position: relative;
    z-index: 1;
  }

  .theme-search {
    display: flex;
    gap: 0.5rem;
  }

  .theme-empty {
    text-align: center;
    padding: 3rem;
    color: #6b7280;
  }

  .theme-loading {
    text-align: center;
    padding: 2rem;
    color: #6b7280;
  }

  .theme-card {
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    overflow: hidden;
    transition: box-shadow 0.15s;
  }

  .theme-card:hover {
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  .theme-card-active {
    border: 2px solid #4f46e5;
  }

  .theme-screenshot {
    height: 150px;
    background-color: #f3f4f6;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .theme-screenshot img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .theme-screenshot-placeholder {
    font-size: 3rem;
  }

  .theme-premium-badge {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: #f59e0b;
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .theme-info {
    padding: 1rem;
  }

  .theme-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }

  .theme-name {
    margin: 0;
    font-size: 1rem;
  }

  .theme-rating {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }

  .theme-downloads {
    color: #6b7280;
    font-size: 0.75rem;
  }

  .theme-description {
    color: #6b7280;
    font-size: 0.875rem;
    margin: 0 0 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .theme-meta {
    color: #9ca3af;
    font-size: 0.75rem;
    margin: 0 0 1rem;
  }

  .theme-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
`
