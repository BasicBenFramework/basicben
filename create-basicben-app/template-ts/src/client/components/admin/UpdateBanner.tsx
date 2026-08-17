import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'

interface UpdateInfo {
  hasUpdates: boolean
  coreUpdate?: {
    current: string
    latest: string
  }
  pluginCount: number
}

export default function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkUpdates()
  }, [])

  const checkUpdates = async () => {
    try {
      const data = await api.get<{
        // A check that failed reports { available: false, error } rather than
        // throwing, so the version fields are only there when one is offered.
        core: { available?: boolean; current?: string; latest?: string } | null
        plugins: unknown[]
      }>('/api/updates/check')

      const core = data.core
      const coreUpdate = core?.available && core.current && core.latest
        ? { current: core.current, latest: core.latest }
        : undefined

      setUpdate({
        hasUpdates: Boolean(coreUpdate) || data.plugins.length > 0,
        coreUpdate,
        pluginCount: data.plugins.length
      })
    } catch (error) {
      // Silently fail - banner is non-critical
    } finally {
      setLoading(false)
    }
  }

  if (loading || !update?.hasUpdates || dismissed) {
    return null
  }

  const getMessage = () => {
    const parts: string[] = []

    if (update.coreUpdate) {
      parts.push(`BasicBen ${update.coreUpdate.latest} is available (you're running ${update.coreUpdate.current})`)
    }

    if (update.pluginCount > 0) {
      parts.push(`${update.pluginCount} plugin update${update.pluginCount > 1 ? 's' : ''}`)
    }


    if (update.coreUpdate) {
      return parts[0] + (parts.length > 1 ? ` and ${parts.slice(1).join(', ')}` : '')
    }

    return parts.join(' and ') + ' available'
  }

  return (
    <>
      <style>{bannerStyles}</style>
      <div className="update-banner">
        <div className="update-banner-content">
          <span className="update-banner-icon">⬆️</span>
          <span className="update-banner-message">{getMessage()}</span>
        </div>
        <div className="update-banner-actions">
          <a href="/admin/updates" className="update-banner-btn update-banner-btn-primary">
            View Details
          </a>
          <button
            onClick={() => setDismissed(true)}
            className="update-banner-btn update-banner-btn-secondary"
          >
            Dismiss
          </button>
        </div>
      </div>
    </>
  )
}

const bannerStyles = `
  .update-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1.5rem;
    background-color: var(--accent);
    color: white;
  }

  .update-banner-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .update-banner-icon {
    font-size: 1.25rem;
  }

  .update-banner-message {
    font-size: 0.875rem;
  }

  .update-banner-actions {
    display: flex;
    gap: 0.5rem;
  }

  .update-banner-btn {
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
  }

  .update-banner-btn-primary {
    background-color: white;
    color: var(--accent);
    border: none;
  }

  .update-banner-btn-primary:hover {
    background-color: var(--surface-hover);
  }

  .update-banner-btn-secondary {
    background-color: transparent;
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.3);
  }

  .update-banner-btn-secondary:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  @media (max-width: 768px) {
    .update-banner {
      flex-direction: column;
      align-items: flex-start;
    }

    .update-banner-actions {
      width: 100%;
    }

    .update-banner-btn {
      flex: 1;
      text-align: center;
    }
  }
`
