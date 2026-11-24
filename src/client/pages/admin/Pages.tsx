import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api.ts'
import AdminLayout from '../../layouts/AdminLayout.tsx'
import { Link } from '../../components/Link.tsx'
import { Pagination, type PageMeta } from '../../components/admin/Pagination.tsx'
import { useT } from '../../i18n/index.ts'

interface Page {
  id: number
  title: string
  slug: string
  published: boolean
  template: string
  created_at: string
}

export default function AdminPages() {
  const { t } = useT()
  const [pages, setPages] = useState<Page[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPages(page)
  }, [page])

  const loadPages = async (which: number) => {
    setLoading(true)

    try {
      const res = await api.get<{ pages: Page[]; meta: PageMeta }>(`/api/pages?page=${which}`)
      setPages(res?.pages || [])
      setMeta(res?.meta || null)
    } catch (error) {
      console.error('Failed to load pages:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm(t('Are you sure you want to delete this page?'))) return

    try {
      await api.delete(`/api/pages/${id}`)

      // Reload rather than splice: the view is a window on the server's
      // ordering, so dropping a row locally hides whatever should have moved
      // up into it. Step back when the last row on a page goes.
      const emptied = pages.length === 1 && page > 1

      if (emptied) setPage(page - 1)
      else loadPages(page)
    } catch (error) {
      alert(t('Failed to delete page'))
    }
  }

  if (loading) {
    return (
      <AdminLayout title={t('Pages')}>
        <div className="admin-loading">{t('Loading...')}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout
      title={t('Pages')}
      actions={
        <Link href="/admin/pages/new" className="admin-btn admin-btn-primary">
          {t('+ New Page')}
        </Link>
      }
    >
      <div className="admin-card">
        {pages.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)', textAlign: 'center', padding: '2rem' }}>
            {t('No pages yet. Create your first page!')}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('Title')}</th>
                <th>{t('Slug')}</th>
                <th>{t('Template')}</th>
                <th>{t('Status')}</th>
                <th>{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pages.map(page => (
                <tr key={page.id}>
                  <td>
                    <Link href={`/admin/pages/${page.id}/edit`} style={{ color: 'var(--accent)', fontWeight: 500 }}>
                      {page.title}
                    </Link>
                  </td>
                  <td><code>/{page.slug}</code></td>
                  <td>{page.template}</td>
                  <td>
                    <span className={`admin-badge ${page.published ? 'admin-badge-success' : 'admin-badge-warning'}`}>
                      {page.published ? t('Published') : t('Draft')}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <Link href={`/admin/pages/${page.id}/edit`} className="admin-btn admin-btn-secondary">
                        {t('Edit')}
                      </Link>
                      <button
                        onClick={() => handleDelete(page.id)}
                        className="admin-btn admin-btn-danger"
                      >
                        {t('Delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {meta && <Pagination meta={meta} onChange={setPage} noun={t('pages')} />}
      </div>
    </AdminLayout>
  )
}
