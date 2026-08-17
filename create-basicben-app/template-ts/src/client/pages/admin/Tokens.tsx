import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface Token {
  id: number
  name: string
  scopes: string[]
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

const SCOPE_LABELS: Record<string, string> = {
  'content:read': 'Read posts, pages, categories and tags',
  'content:write': 'Create and edit content',
  'media:read': 'Read media',
  'media:write': 'Upload and delete media'
}

/**
 * API tokens for programs: a static site build, a sync job, someone's app.
 *
 * The plaintext is shown once, here, and is unrecoverable afterwards — the
 * server stores only a hash. That is the point, and the UI has to say so
 * clearly enough that nobody closes the panel expecting to find it later.
 */
export default function AdminTokens() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [available, setAvailable] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [issued, setIssued] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['content:read'])
  const [expiresInDays, setExpiresInDays] = useState('')

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    try {
      const res = await api.get<{ tokens: Token[]; scopes: string[] }>('/api/tokens')
      setTokens(res?.tokens || [])
      setAvailable(res?.scopes || [])
    } catch {
      setNotice({ tone: 'error', text: 'Could not load tokens.' })
    } finally {
      setLoading(false)
    }
  }

  const toggleScope = (scope: string) => {
    setScopes(current =>
      current.includes(scope) ? current.filter(s => s !== scope) : [...current, scope]
    )
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    setCreating(true)
    setNotice(null)

    try {
      const res = await api.post<{ token: string }>('/api/tokens', {
        name,
        scopes,
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined
      })

      setIssued(res.token)
      setCopied(false)
      setName('')
      setScopes(['content:read'])
      setExpiresInDays('')
      await load()
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message || 'Could not create the token.' })
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (token: Token) => {
    if (!confirm(`Revoke "${token.name}"? Anything using it stops working immediately.`)) return

    try {
      await api.delete(`/api/tokens/${token.id}`)
      setTokens(tokens.filter(t => t.id !== token.id))
      setNotice({ tone: 'ok', text: `"${token.name}" revoked.` })
    } catch {
      setNotice({ tone: 'error', text: 'Could not revoke the token.' })
    }
  }

  const copy = async () => {
    if (!issued) return

    try {
      await navigator.clipboard.writeText(issued)
      setCopied(true)
    } catch {
      // Clipboard access can be refused; the value is on screen and selectable,
      // so this is a convenience failing rather than the feature failing.
      setCopied(false)
    }
  }

  if (loading) {
    return (
      <AdminLayout title="API tokens">
        <div className="admin-loading">Loading…</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="API tokens">
      <style>{tokenStyles}</style>

      {notice && (
        <div className={`token-notice token-notice-${notice.tone}`}>{notice.text}</div>
      )}

      {issued && (
        <div className="token-issued">
          <p className="token-issued-title">Copy this token now</p>
          <p className="token-issued-body">
            It will not be shown again — only a hash is stored, so it cannot be recovered.
            Losing it means issuing another.
          </p>
          <div className="token-issued-value">
            <code>{issued}</code>
            <button type="button" onClick={copy} className="admin-btn admin-btn-secondary">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="admin-btn admin-btn-secondary"
          >
            I have saved it
          </button>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">New token</h2>
        </div>

        <form onSubmit={handleCreate} className="token-form">
          <label className="token-field">
            <span className="token-label">Name</span>
            <input
              className="admin-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Static site build"
              required
            />
            <span className="token-hint">What this token is for, so you can recognise it later.</span>
          </label>

          <fieldset className="token-field">
            <legend className="token-label">Scopes</legend>
            {available.map(scope => (
              <label key={scope} className="token-scope">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                />
                <code>{scope}</code>
                <span className="token-hint">{SCOPE_LABELS[scope] ?? ''}</span>
              </label>
            ))}
            <span className="token-hint">
              A write scope also grants the matching read.
            </span>
          </fieldset>

          <label className="token-field">
            <span className="token-label">Expires after (days)</span>
            <input
              className="admin-input"
              type="number"
              min="1"
              value={expiresInDays}
              onChange={e => setExpiresInDays(e.target.value)}
              placeholder="Leave blank for no expiry"
            />
          </label>

          <div>
            <button
              type="submit"
              className="admin-btn admin-btn-primary"
              disabled={creating || scopes.length === 0}
            >
              {creating ? 'Creating…' : 'Create token'}
            </button>
          </div>
        </form>
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Your tokens</h2>
          <span className="token-count">{tokens.length}</span>
        </div>

        {tokens.length === 0 ? (
          <div className="token-empty">
            <p>No tokens yet. Create one above to read this site's content from elsewhere.</p>
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Scopes</th>
                <th>Last used</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(token => (
                <tr key={token.id}>
                  <td><strong>{token.name}</strong></td>
                  <td>
                    {token.scopes.map(scope => (
                      <code key={scope} className="token-scope-chip">{scope}</code>
                    ))}
                  </td>
                  <td className="token-muted">{formatDate(token.lastUsedAt) ?? 'Never'}</td>
                  <td className="token-muted">{formatDate(token.expiresAt) ?? 'Never'}</td>
                  <td>
                    <button
                      onClick={() => handleRevoke(token)}
                      className="admin-btn admin-btn-secondary"
                    >
                      Revoke
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

/** Dates arrive as ISO strings, or null for "has not happened". */
function formatDate(value: string | null): string | null {
  if (!value) return null

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString()
}

const tokenStyles = `
  .token-notice {
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid var(--border);
    margin-bottom: 16px;
    font-size: 14px;
  }

  .token-notice-ok {
    background: var(--tint-success);
    border-color: var(--success);
    color: var(--success);
  }

  .token-notice-error {
    background: var(--tint-danger);
    border-color: var(--danger);
    color: var(--danger);
  }

  .token-issued {
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--warning);
    background: var(--tint-warning);
    margin-bottom: 16px;
  }

  .token-issued-title {
    margin: 0 0 4px;
    font-weight: 600;
    color: var(--fg);
  }

  .token-issued-body {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--fg-muted);
  }

  .token-issued-value {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }

  .token-issued-value code {
    flex: 1;
    min-width: 240px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    overflow-wrap: anywhere;
  }

  .token-form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .token-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 0;
    padding: 0;
    margin: 0;
  }

  .token-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
    padding: 0;
  }

  .token-hint {
    font-size: 12px;
    color: var(--fg-muted);
  }

  .token-scope {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 13px;
    flex-wrap: wrap;
  }

  .token-scope code,
  .token-scope-chip {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    background: var(--surface-hover);
    border-radius: 4px;
    padding: 2px 6px;
  }

  .token-scope-chip {
    margin-right: 4px;
    display: inline-block;
  }

  .token-count {
    font-size: 13px;
    color: var(--fg-muted);
    background: var(--surface-hover);
    border-radius: 999px;
    padding: 2px 10px;
  }

  .token-muted {
    color: var(--fg-muted);
    font-size: 13px;
  }

  .token-empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--fg-muted);
    font-size: 14px;
  }
`
