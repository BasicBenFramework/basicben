import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import { useT } from '../../i18n'

interface Token {
  id: number
  name: string
  scopes: string[]
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

/** Scopes that let a program change the site rather than only read it. */
const WRITE_SCOPES = ['content:write', 'media:write']

/**
 * API tokens for programs: a static site build, a sync job, someone's app.
 *
 * The plaintext is shown once, here, and is unrecoverable afterwards — the
 * server stores only a hash. That is the point, and the UI has to say so
 * clearly enough that nobody closes the panel expecting to find it later.
 */
export default function AdminTokens() {
  const { t, locale } = useT()
  const SCOPE_LABELS: Record<string, string> = {
    'content:read': t('Read published posts, pages, categories and tags (/api/v1)'),
    'content:write': t('Create, edit and trash posts; manage tags and categories — as you'),
    'media:read': t('Read media (/api/v1)'),
    'media:write': t('Upload and edit media — as you')
  }
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
      setNotice({ tone: 'error', text: t('Could not load tokens.') })
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
      setNotice({ tone: 'error', text: (error as Error).message || t('Could not create the token.') })
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (token: Token) => {
    if (!confirm(t('Revoke "{name}"? Anything using it stops working immediately.', { name: token.name }))) return

    try {
      await api.delete(`/api/tokens/${token.id}`)
      setTokens(tokens.filter(t => t.id !== token.id))
      setNotice({ tone: 'ok', text: t('"{name}" revoked.', { name: token.name }) })
    } catch {
      setNotice({ tone: 'error', text: t('Could not revoke the token.') })
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
      <AdminLayout title={t('API tokens')}>
        <div className="admin-loading">{t('Loading…')}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={t('API tokens')}>
      <style>{tokenStyles}</style>

      {notice && (
        <div className={`token-notice token-notice-${notice.tone}`}>{notice.text}</div>
      )}

      {issued && (
        <div className="token-issued">
          <p className="token-issued-title">{t('Copy this token now')}</p>
          <p className="token-issued-body">
            {t('It will not be shown again — only a hash is stored, so it cannot be recovered. Losing it means issuing another.')}
          </p>
          <div className="token-issued-value">
            <code>{issued}</code>
            <button type="button" onClick={copy} className="admin-btn admin-btn-secondary">
              {copied ? t('Copied') : t('Copy')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="admin-btn admin-btn-secondary"
          >
            {t('I have saved it')}
          </button>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">{t('New token')}</h2>
        </div>

        <form onSubmit={handleCreate} className="token-form">
          <label className="token-field">
            <span className="token-label">{t('Name')}</span>
            <input
              className="admin-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('Static site build')}
              required
            />
            <span className="token-hint">{t('What this token is for, so you can recognise it later.')}</span>
          </label>

          <fieldset className="token-field">
            <legend className="token-label">{t('Scopes')}</legend>
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
              {t('A write scope also grants the matching read.')}
            </span>

            {/* Said before the token exists, not after: the moment to decide
                whether a build server should be able to rewrite the blog is
                while the box is still unticked. */}
            {scopes.some(scope => WRITE_SCOPES.includes(scope)) && (
              <div className="token-write-warning" role="alert">
                <strong>{t('This token can change your site.')}</strong>{' '}
                {t('It acts as you, with your role: anything you can create, edit, publish or trash, a program holding it can too — including publishing posts if your role allows it. It cannot manage users, settings or other tokens, cannot empty the trash, and is refused while someone has a post open in the editor. Writes are rate limited per token and logged with its id. Give it an expiry, keep it out of client-side code, and revoke it the moment it might have leaked.')}
              </div>
            )}
          </fieldset>

          <label className="token-field">
            <span className="token-label">{t('Expires after (days)')}</span>
            <input
              className="admin-input"
              type="number"
              min="1"
              value={expiresInDays}
              onChange={e => setExpiresInDays(e.target.value)}
              placeholder={t('Leave blank for no expiry')}
            />
          </label>

          <div>
            <button
              type="submit"
              className="admin-btn admin-btn-primary"
              disabled={creating || scopes.length === 0}
            >
              {creating ? t('Creating…') : t('Create token')}
            </button>
          </div>
        </form>
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">{t('Your tokens')}</h2>
          <span className="token-count">{tokens.length}</span>
        </div>

        {tokens.length === 0 ? (
          <div className="token-empty">
            <p>{t("No tokens yet. Create one above to read — or, with a write scope, change — this site's content from elsewhere.")}</p>
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Scopes')}</th>
                <th>{t('Last used')}</th>
                <th>{t('Expires')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(token => (
                <tr key={token.id}>
                  <td><strong>{token.name}</strong></td>
                  <td>
                    {token.scopes.map(scope => (
                      <code
                        key={scope}
                        className={`token-scope-chip ${WRITE_SCOPES.includes(scope) ? 'token-scope-write' : ''}`}
                        title={WRITE_SCOPES.includes(scope) ? t('Can change the site') : undefined}
                      >
                        {scope}
                      </code>
                    ))}
                  </td>
                  <td className="token-muted">{formatDate(token.lastUsedAt, locale) ?? t('Never')}</td>
                  <td className="token-muted">{formatDate(token.expiresAt, locale) ?? t('Never')}</td>
                  <td>
                    <button
                      onClick={() => handleRevoke(token)}
                      className="admin-btn admin-btn-secondary"
                    >
                      {t('Revoke')}
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
function formatDate(value: string | null, locale: string): string | null {
  if (!value) return null

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(locale)
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

  .token-scope-write {
    background: var(--tint-warning);
    color: var(--fg);
    border: 1px solid var(--warning);
  }

  .token-write-warning {
    margin-top: 8px;
    padding: 12px 14px;
    border-radius: 8px;
    border: 1px solid var(--warning);
    background: var(--tint-warning);
    color: var(--fg);
    font-size: 13px;
    line-height: 1.5;
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
