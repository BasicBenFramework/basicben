import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import { useT } from '../../i18n'

interface Category {
  id: number
  name: string
  slug: string
  description?: string
  post_count?: number
}

export default function AdminCategories() {
  const { t } = useT()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formData, setFormData] = useState({ name: '', slug: '', description: '' })

  useEffect(() => {
    loadCategories()
  }, [])

  const loadCategories = async () => {
    try {
      const res = await api.get<{ categories: Category[] }>('/api/categories')
      setCategories(res?.categories || [])
    } catch (error) {
      console.error('Failed to load categories:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      if (editingId) {
        await api.put(`/api/categories/${editingId}`, formData)
      } else {
        await api.post('/api/categories', formData)
      }

      setFormData({ name: '', slug: '', description: '' })
      setShowForm(false)
      setEditingId(null)
      loadCategories()
    } catch (error: any) {
      alert(error.message || t('Failed to save category'))
    }
  }

  const handleEdit = (category: Category) => {
    setFormData({
      name: category.name,
      slug: category.slug,
      description: category.description || ''
    })
    setEditingId(category.id)
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    if (!confirm(t('Are you sure you want to delete this category?'))) return

    try {
      await api.delete(`/api/categories/${id}`)
      setCategories(categories.filter(c => c.id !== id))
    } catch (error) {
      alert(t('Failed to delete category'))
    }
  }

  const handleCancel = () => {
    setFormData({ name: '', slug: '', description: '' })
    setShowForm(false)
    setEditingId(null)
  }

  if (loading) {
    return (
      <AdminLayout title={t('Categories')}>
        <div className="admin-loading">{t('Loading...')}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={t('Categories')}>
      <div className="admin-grid admin-grid-2">
        {/* Form */}
        <div className="admin-card">
          <h3 className="admin-card-title">
            {editingId ? t('Edit Category') : t('Add New Category')}
          </h3>
          <form onSubmit={handleSubmit}>
            <div className="admin-form-group">
              <label className="admin-label">{t('Name')}</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="admin-input"
                placeholder={t('Category name')}
                required
              />
            </div>

            <div className="admin-form-group">
              <label className="admin-label">{t('Slug')}</label>
              <input
                type="text"
                value={formData.slug}
                onChange={e => setFormData({ ...formData, slug: e.target.value })}
                className="admin-input"
                placeholder={t('category-slug (auto-generated if empty)')}
              />
            </div>

            <div className="admin-form-group">
              <label className="admin-label">{t('Description')}</label>
              <textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                className="admin-textarea"
                style={{ minHeight: '80px' }}
                placeholder={t('Category description')}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="admin-btn admin-btn-primary">
                {editingId ? t('Update') : t('Add Category')}
              </button>
              {editingId && (
                <button type="button" onClick={handleCancel} className="admin-btn admin-btn-secondary">
                  {t('Cancel')}
                </button>
              )}
            </div>
          </form>
        </div>

        {/* List */}
        <div className="admin-card">
          <h3 className="admin-card-title">{t('All Categories')}</h3>
          {categories.length === 0 ? (
            <p style={{ color: 'var(--fg-muted)' }}>{t('No categories yet.')}</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('Name')}</th>
                  <th>{t('Slug')}</th>
                  <th>{t('Posts')}</th>
                  <th>{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(cat => (
                  <tr key={cat.id}>
                    <td>{cat.name}</td>
                    <td><code>{cat.slug}</code></td>
                    <td>{cat.post_count || 0}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleEdit(cat)}
                          className="admin-btn admin-btn-secondary"
                        >
                          {t('Edit')}
                        </button>
                        <button
                          onClick={() => handleDelete(cat.id)}
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
        </div>
      </div>
    </AdminLayout>
  )
}
