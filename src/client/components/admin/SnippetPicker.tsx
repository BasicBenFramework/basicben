import React, { useEffect, useState } from 'react'
import { api } from '../../../helpers/api'
import { useT } from '../../i18n'

export interface SnippetItem {
  id: number
  name: string
  content: string
  author_name: string | null
  can_edit: boolean
}

interface SnippetPickerProps {
  /** Drops the snippet's Markdown in at the editor's caret. */
  onInsert: (text: string) => void
  disabled?: boolean
}

/**
 * The "Insert snippet" toolbar button and the list it opens.
 *
 * Lives in the Markdown editor's toolbar, beside the media button, because
 * that is where the caret is: the snippet goes in where you were typing, not
 * at the end of the post. The text is copied in — editing the snippet later
 * does not change posts that already used it.
 *
 * The list loads when first opened rather than with the editor, so a post
 * that never uses a snippet costs no request. A 403 (a contributor) is shown
 * as an explanation rather than an empty list that looks broken.
 */
export default function SnippetPicker({ onInsert, disabled }: SnippetPickerProps) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [snippets, setSnippets] = useState<SnippetItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open || snippets) return
    api.get<{ snippets: SnippetItem[] }>('/api/snippets')
      .then(res => setSnippets(res?.snippets || []))
      .catch((err: Error) => setError(err.message === 'Forbidden' ? t('Snippets are available to authors and editors.') : t('Could not load snippets.')))
  }, [open, snippets])

  const needle = search.trim().toLowerCase()
  const shown = (snippets || []).filter(snippet => !needle || snippet.name.toLowerCase().includes(needle))

  const choose = (snippet: SnippetItem) => {
    onInsert(snippet.content)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        title={t('Insert snippet')}
        aria-label={t('Insert snippet')}
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="markdown-editor-mark"
      >
        ⧉
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('Insert snippet')}
          onClick={() => setOpen(false)}
          onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: '1rem'
          }}
        >
          <div
            onClick={event => event.stopPropagation()}
            style={{
              background: 'var(--surface)',
              borderRadius: '0.5rem',
              width: 'min(560px, 100%)',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '1rem', borderBottom: '1px solid var(--border)' }}>
              <strong style={{ marginRight: 'auto' }}>{t('Insert snippet')}</strong>
              <input
                type="search"
                autoFocus
                value={search}
                onChange={event => setSearch(event.target.value)}
                // This dialog renders inside the post's <form>, where Enter
                // would submit the post. Here it means "insert the top match".
                onKeyDown={event => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  if (shown[0]) choose(shown[0])
                }}
                placeholder={t('Search snippets')}
                className="admin-input"
                style={{ maxWidth: '200px' }}
              />
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setOpen(false)}>
                {t('Close')}
              </button>
            </div>

            <div style={{ overflowY: 'auto', padding: '0.5rem 1rem 1rem' }}>
              {error && <p style={{ color: 'var(--fg-muted)' }}>{error}</p>}
              {!error && !snippets && <p style={{ color: 'var(--fg-muted)' }}>{t('Loading…')}</p>}
              {!error && snippets && shown.length === 0 && (
                <p style={{ color: 'var(--fg-muted)' }}>
                  {snippets.length === 0
                    ? t('No snippets yet. Add them under Snippets in the admin menu.')
                    : t('No snippet matches that search.')}
                </p>
              )}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
                {shown.map(snippet => (
                  <li key={snippet.id}>
                    <button
                      type="button"
                      onClick={() => choose(snippet)}
                      className="admin-btn admin-btn-secondary"
                      style={{ width: '100%', textAlign: 'left', display: 'block', whiteSpace: 'normal' }}
                    >
                      <strong>{snippet.name}</strong>
                      <br />
                      <small style={{ color: 'var(--fg-muted)' }}>
                        {snippet.content.length > 140 ? `${snippet.content.slice(0, 140)}…` : snippet.content}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
