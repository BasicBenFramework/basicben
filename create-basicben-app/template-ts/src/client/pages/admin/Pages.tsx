import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface Page {
  id: number
  title: string
  slug: string
  published: boolean
  template: string
  created_at: string
}

export default function AdminPages() {
  const [pages, setPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPages()
  }, [])

  const loadPages = async () => {
    try {
      const res = await api.get('/api/pages')
      setPages(res?.pages || [])
    } catch (error) {
      console.error('Failed to load pages:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this page?')) return

    try {
      await api.delete(`/api/pages/${id}`)
      setPages(pages.filter(p => p.id !== id))
    } catch (error) {
      alert('Failed to delete page')
    }
  }

  if (loading) {
    return (
      <AdminLayout title="Pages">
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Pages">
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">All Pages</h2>
          <a href="/admin/pages/new" className="admin-btn admin-btn-primary">
            + New Page
          </a>
        </div>

        {pages.length === 0 ? (
          <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem' }}>
            No pages yet. Create your first page!
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Slug</th>
                <th>Template</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pages.map(page => (
                <tr key={page.id}>
                  <td>
                    <a href={`/admin/pages/${page.id}/edit`} style={{ color: '#4f46e5', fontWeight: 500 }}>
                      {page.title}
                    </a>
                  </td>
                  <td><code>/{page.slug}</code></td>
                  <td>{page.template}</td>
                  <td>
                    <span className={`admin-badge ${page.published ? 'admin-badge-success' : 'admin-badge-warning'}`}>
                      {page.published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <a href={`/admin/pages/${page.id}/edit`} className="admin-btn admin-btn-secondary">
                        Edit
                      </a>
                      <button
                        onClick={() => handleDelete(page.id)}
                        className="admin-btn admin-btn-danger"
                      >
                        Delete
                      </button>
                    </div>
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
