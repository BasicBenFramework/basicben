import React, { useEffect, useState } from 'react'
import { api } from '../../../helpers/api.ts'
import AdminLayout from '../../layouts/AdminLayout.tsx'
import MarkdownEditor from '../../components/MarkdownEditor.tsx'
import type { SnippetItem } from '../../components/admin/SnippetPicker.tsx'
import { useT } from '../../i18n/index.ts'

interface Draft {
  id: number | null
  name: string
  content: string
}

const EMPTY: Draft = { id: null, name: '', content: '' }

/**
 * The snippet library: reusable Markdown for the editor's "Insert snippet".
 *
 * One shared list for the whole site — the point is that the disclosure
 * paragraph is written once. Anyone who writes (authors and up) may add
 * snippets and change their own; an editor may change anyone's. The server
 * decides that per row and says so in `can_edit`, so this page only has to
 * hide the buttons it would refuse.
 *
 * Editing a snippet does not touch posts that already used it: insertion
 * copies the text.
 */
export default function AdminSnippets() {
  const { t } = useT()
  const [snippets, setSnippets] = useState<SnippetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    try {
      const res = await api.get<{ snippets: SnippetItem[] }>('/api/snippets')
      setSnippets(res?.snippets || [])
    } catch (error) {
      setNotice({
        tone: 'error',
        text: (error as Error).message === 'Forbidden'
          ? t('Snippets are available to authors and editors.')
          : t('Could not load snippets.')
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setNotice(null)

    try {
      const body = { name: draft.name, content: draft.content }
      if (draft.id) await api.put(`/api/snippets/${draft.id}`, body)
      else await api.post('/api/snippets', body)

      setNotice({ tone: 'ok', text: draft.id ? t('"{name}" updated.', { name: draft.name }) : t('"{name}" added.', { name: draft.name }) })
      setDraft(EMPTY)
      await load()
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message || t('Could not save the snippet.') })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (snippet: SnippetItem) => {
    if (!confirm(t('Delete "{name}"? Posts that already use it keep their copy.', { name: snippet.name }))) return

    try {
      await api.delete(`/api/snippets/${snippet.id}`)
      setSnippets(current => current.filter(s => s.id !== snippet.id))
      if (draft.id === snippet.id) setDraft(EMPTY)
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message || t('Could not delete the snippet.') })
    }
  }

  if (loading) {
    return (
      <AdminLayout title={t('Snippets')}>
        <div className="admin-loading">{t('Loading…')}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={t('Snippets')}>
      {notice && (
        <div
          className="admin-card"
          role={notice.tone === 'error' ? 'alert' : 'status'}
          style={{ color: notice.tone === 'error' ? 'var(--danger)' : 'var(--success)' }}
        >
          {notice.text}
        </div>
      )}

      <div className="admin-card">
        <h2 className="admin-card-title">{draft.id ? t('Edit snippet') : t('New snippet')}</h2>
        <form onSubmit={handleSave}>
          <div className="admin-form-group">
            <label className="admin-label" htmlFor="snippet-name">{t('Name')}</label>
            <input
              id="snippet-name"
              className="admin-input"
              value={draft.name}
              maxLength={100}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder={t('Affiliate disclosure')}
              required
            />
          </div>
          <div className="admin-form-group">
            <label className="admin-label">{t('Content')}</label>
            <MarkdownEditor
              name="content"
              value={draft.content}
              onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
              minHeight="180px"
              placeholder={t('The Markdown that gets inserted.')}
              required
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
              {saving ? t('Saving…') : draft.id ? t('Update snippet') : t('Add snippet')}
            </button>
            {draft.id && (
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setDraft(EMPTY)}>
                {t('Cancel')}
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="admin-card">
        <h2 className="admin-card-title">{t('Library')}</h2>
        {snippets.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)' }}>
            {t('No snippets yet. Add one above, then use "Insert snippet" in the post editor\'s toolbar.')}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Preview')}</th>
                <th>{t('Added by')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {snippets.map(snippet => (
                <tr key={snippet.id}>
                  <td><strong>{snippet.name}</strong></td>
                  <td style={{ color: 'var(--fg-muted)', fontSize: '13px' }}>
                    {snippet.content.length > 100 ? `${snippet.content.slice(0, 100)}…` : snippet.content}
                  </td>
                  <td style={{ color: 'var(--fg-muted)', fontSize: '13px' }}>{snippet.author_name ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {snippet.can_edit && (
                      <>
                        <button
                          type="button"
                          className="admin-btn admin-btn-secondary"
                          onClick={() => setDraft({ id: snippet.id, name: snippet.name, content: snippet.content })}
                        >
                          {t('Edit')}
                        </button>{' '}
                        <button type="button" className="admin-btn admin-btn-secondary" onClick={() => handleDelete(snippet)}>
                          {t('Delete')}
                        </button>
                      </>
                    )}
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
