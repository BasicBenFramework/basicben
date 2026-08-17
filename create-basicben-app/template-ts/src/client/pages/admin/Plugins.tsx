import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface Plugin {
  name: string
  version: string
  description?: string
  author?: string
  active: boolean
  /** Where the plugin came from: a file in plugins/, or the server config. */
  source: 'directory' | 'config'
}

/**
 * Plugins are source in this repository, not downloads.
 *
 * There is no browse-and-install tab because there is nothing sound to install
 * into: a host that rebuilds from an image throws away anything written to disk
 * at runtime, so an "installed" plugin would vanish on the next deploy. A
 * plugin arrives the way the rest of the app does — through git — and this page
 * says which ones are present and which are switched on.
 */
export default function AdminPlugins() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadPlugins()
  }, [])

  const loadPlugins = async () => {
    try {
      const res = await api.get<{ plugins: Plugin[] }>('/api/plugins')
      setPlugins(res?.plugins || [])
    } catch (error) {
      setNotice({ tone: 'error', text: 'Could not load plugins.' })
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = async (name: string, currentlyActive: boolean) => {
    setToggling(name)
    setNotice(null)

    try {
      const endpoint = currentlyActive ? '/api/plugins/deactivate' : '/api/plugins/activate'
      await api.post(endpoint, { name })

      setPlugins(plugins.map(plugin => ({
        ...plugin,
        active: plugin.name === name ? !currentlyActive : plugin.active
      })))

      // Toggling writes to the enabled list the server reads at boot. Hooks and
      // routes are bound in the running process, so nothing changes until it
      // restarts — saying so is the difference between a working feature and
      // one that looks broken.
      setNotice({
        tone: 'ok',
        text: `${name} ${currentlyActive ? 'deactivated' : 'activated'}. Restart the server to apply.`
      })
    } catch (error) {
      setNotice({ tone: 'error', text: `Could not toggle ${name}.` })
    } finally {
      setToggling(null)
    }
  }

  if (loading) {
    return (
      <AdminLayout title="Plugins">
        <div className="admin-loading">Loading…</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Plugins">
      <style>{pluginStyles}</style>

      {notice && (
        <div className={`plugin-notice plugin-notice-${notice.tone}`}>
          {notice.text}
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Plugins</h2>
          <span className="plugin-count">{plugins.length}</span>
        </div>

        {plugins.length === 0 ? (
          <div className="plugin-empty">
            <p className="plugin-empty-title">No plugins yet</p>
            <p>
              Drop a <code>.js</code> or <code>.ts</code> file exporting a plugin object into{' '}
              <code>plugins/</code>, or import one and pass it to{' '}
              <code>createServer({'{ plugins: [...] }'})</code>.
            </p>
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Plugin</th>
                <th>Version</th>
                <th>Source</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plugins.map(plugin => (
                <tr key={plugin.name}>
                  <td>
                    <strong>{plugin.name}</strong>
                    {plugin.description && (
                      <p className="plugin-description">{plugin.description}</p>
                    )}
                    {plugin.author && (
                      <p className="plugin-author">by {plugin.author}</p>
                    )}
                  </td>
                  <td>v{plugin.version}</td>
                  <td>
                    <span className="plugin-source">
                      {plugin.source === 'directory' ? 'plugins/' : 'config'}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`admin-badge ${
                        plugin.active ? 'admin-badge-success' : 'admin-badge-warning'
                      }`}
                    >
                      {plugin.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => handleToggle(plugin.name, plugin.active)}
                      className={`admin-btn ${
                        plugin.active ? 'admin-btn-secondary' : 'admin-btn-primary'
                      }`}
                      disabled={toggling === plugin.name}
                    >
                      {toggling === plugin.name
                        ? 'Saving…'
                        : plugin.active
                          ? 'Deactivate'
                          : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  )
}

const pluginStyles = `
  .plugin-notice {
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid var(--border);
    margin-bottom: 16px;
    font-size: 14px;
  }

  .plugin-notice-ok {
    background: var(--tint-success);
    border-color: var(--success);
    color: var(--success);
  }

  .plugin-notice-error {
    background: var(--tint-danger);
    border-color: var(--danger);
    color: var(--danger);
  }

  .plugin-count {
    font-size: 13px;
    color: var(--fg-muted);
    background: var(--surface-hover);
    border-radius: 999px;
    padding: 2px 10px;
  }

  .plugin-empty {
    padding: 48px 20px;
    text-align: center;
    color: var(--fg-muted);
    font-size: 14px;
    line-height: 1.6;
  }

  .plugin-empty-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--fg);
    margin: 0 0 8px;
  }

  .plugin-empty code,
  .plugin-source {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    background: var(--surface-hover);
    border-radius: 4px;
    padding: 2px 6px;
  }

  .plugin-source {
    color: var(--fg-muted);
  }

  .plugin-description {
    margin: 4px 0 0;
    color: var(--fg-muted);
    font-size: 13px;
  }

  .plugin-author {
    margin: 2px 0 0;
    color: var(--fg-subtle);
    font-size: 12px;
  }
`
