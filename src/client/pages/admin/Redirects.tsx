import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api.ts'
import AdminLayout from '../../layouts/AdminLayout.tsx'
import { Pagination, type PageMeta } from '../../components/admin/Pagination.tsx'
import { useT, slots } from '../../i18n/index.ts'

interface Redirect {
  id: number
  from_path: string
  to_path: string
  status: number
  source: 'manual' | 'post' | 'page'
  hits: number
  created_at: string
}

const EMPTY = { from_path: '', to_path: '', status: '301' }

/**
 * Redirects the front end applies.
 *
 * The CMS is headless, so nothing here answers a visitor's request itself:
 * the list is served at /api/v1/redirects for the front end to apply. Rows
 * marked "post" or "page" were recorded automatically when a published post
 * or page changed its slug.
 */
export default function AdminRedirects() {
  const { t } = useT()
  const [redirects, setRedirects] = useState<Redirect[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    load(page, search)
  }, [page])

  const load = async (which: number, term: string) => {
    try {
      const params = new URLSearchParams({ page: String(which) })
      if (term.trim()) params.set('search', term.trim())

      const res = await api.get<{ redirects: Redirect[]; meta: PageMeta }>(`/api/redirects?${params}`)
      setRedirects(res?.redirects || [])
      setMeta(res?.meta || null)
    } catch (err) {
      console.error('Failed to load redirects:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const body = { ...form, status: Number(form.status) }

    try {
      if (editingId) await api.put(`/api/redirects/${editingId}`, body)
      else await api.post('/api/redirects', body)

      setForm(EMPTY)
      setEditingId(null)
      load(page, search)
    } catch (err: any) {
      setError(err.message || t('Failed to save redirect'))
    }
  }

  const handleEdit = (redirect: Redirect) => {
    setForm({ from_path: redirect.from_path, to_path: redirect.to_path, status: String(redirect.status) })
    setEditingId(redirect.id)
    setError('')
  }

  const handleDelete = async (id: number) => {
    if (!confirm(t('Delete this redirect? Visitors to the old path will get a 404.'))) return

    try {
      await api.delete(`/api/redirects/${id}`)
      setRedirects(redirects.filter(r => r.id !== id))
    } catch {
      alert(t('Failed to delete redirect'))
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    load(1, search)
  }

  if (loading) {
    return (
      <AdminLayout title={t('Redirects')}>
        <div className="admin-loading">{t('Loading...')}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={t('Redirects')}>
      <div className="admin-card">
        <h3 className="admin-card-title">{editingId ? t('Edit Redirect') : t('Add Redirect')}</h3>
        <form onSubmit={handleSubmit}>
          <div className="admin-grid admin-grid-2">
            <div className="admin-form-group">
              <label className="admin-label">{t('From path')}</label>
              <input
                type="text"
                value={form.from_path}
                onChange={e => setForm({ ...form, from_path: e.target.value })}
                className="admin-input"
                placeholder={t('/old-page')}
                required
              />
            </div>

            <div className="admin-form-group">
              <label className="admin-label">{t('To')}</label>
              <input
                type="text"
                value={form.to_path}
                onChange={e => setForm({ ...form, to_path: e.target.value })}
                className="admin-input"
                placeholder={t('/new-page or https://example.com/page')}
                required
              />
            </div>
          </div>

          <div className="admin-form-group">
            <label className="admin-label">{t('Type')}</label>
            <select
              value={form.status}
              onChange={e => setForm({ ...form, status: e.target.value })}
              className="admin-select"
            >
              <option value="301">{t('301 - Moved permanently')}</option>
              <option value="302">{t('302 - Temporary')}</option>
            </select>
          </div>

          {error && <p style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>{error}</p>}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="admin-btn admin-btn-primary">
              {editingId ? t('Update') : t('Add Redirect')}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => { setForm(EMPTY); setEditingId(null); setError('') }}
                className="admin-btn admin-btn-secondary"
              >
                {t('Cancel')}
              </button>
            )}
          </div>
        </form>
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
          {slots(t('Your front end applies these: it reads {path} at build time or from edge middleware. Changing the slug of a published post or page adds a 301 here automatically.'), { path: <code>{'/api/v1/redirects'}</code> })}
        </p>
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <h3 className="admin-card-title">{t('All Redirects')}</h3>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="admin-input"
              placeholder={t('Search paths')}
            />
            <button type="submit" className="admin-btn admin-btn-secondary">{t('Search')}</button>
          </form>
        </div>

        {redirects.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)', textAlign: 'center', padding: '2rem' }}>{t('No redirects.')}</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('From')}</th>
                <th>{t('To')}</th>
                <th>{t('Type')}</th>
                <th>{t('Source')}</th>
                <th>{t('Hits')}</th>
                <th>{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {redirects.map(redirect => (
                <tr key={redirect.id}>
                  <td><code>{redirect.from_path}</code></td>
                  <td><code>{redirect.to_path}</code></td>
                  <td>{redirect.status}</td>
                  <td>
                    <span className={`admin-badge ${redirect.source === 'manual' ? 'admin-badge-warning' : 'admin-badge-success'}`}>
                      {redirect.source === 'manual' ? t('Manual') : redirect.source === 'post' ? t('Automatic (post)') : t('Automatic (page)')}
                    </span>
                  </td>
                  <td>{redirect.hits}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => handleEdit(redirect)} className="admin-btn admin-btn-secondary">
                        {t('Edit')}
                      </button>
                      <button onClick={() => handleDelete(redirect.id)} className="admin-btn admin-btn-danger">
                        {t('Delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {meta && <Pagination meta={meta} onChange={setPage} noun={t('redirects')} />}
      </div>
    </AdminLayout>
  )
}
