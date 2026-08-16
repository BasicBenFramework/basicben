import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface Category {
  id: number
  name: string
  slug: string
  description?: string
  post_count?: number
}

export default function AdminCategories() {
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
      alert(error.message || 'Failed to save category')
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
    if (!confirm('Are you sure you want to delete this category?')) return

    try {
      await api.delete(`/api/categories/${id}`)
      setCategories(categories.filter(c => c.id !== id))
    } catch (error) {
      alert('Failed to delete category')
    }
  }

  const handleCancel = () => {
    setFormData({ name: '', slug: '', description: '' })
    setShowForm(false)
    setEditingId(null)
  }

  if (loading) {
    return (
      <AdminLayout title="Categories">
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Categories">
      <div className="admin-grid admin-grid-2">
        {/* Form */}
        <div className="admin-card">
          <h3 className="admin-card-title">
            {editingId ? 'Edit Category' : 'Add New Category'}
          </h3>
          <form onSubmit={handleSubmit}>
            <div className="admin-form-group">
              <label className="admin-label">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="admin-input"
                placeholder="Category name"
                required
              />
            </div>

            <div className="admin-form-group">
              <label className="admin-label">Slug</label>
              <input
                type="text"
                value={formData.slug}
                onChange={e => setFormData({ ...formData, slug: e.target.value })}
                className="admin-input"
                placeholder="category-slug (auto-generated if empty)"
              />
            </div>

            <div className="admin-form-group">
              <label className="admin-label">Description</label>
              <textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                className="admin-textarea"
                style={{ minHeight: '80px' }}
                placeholder="Category description"
              />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="admin-btn admin-btn-primary">
                {editingId ? 'Update' : 'Add Category'}
              </button>
              {editingId && (
                <button type="button" onClick={handleCancel} className="admin-btn admin-btn-secondary">
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* List */}
        <div className="admin-card">
          <h3 className="admin-card-title">All Categories</h3>
          {categories.length === 0 ? (
            <p style={{ color: '#6b7280' }}>No categories yet.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Posts</th>
                  <th>Actions</th>
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
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(cat.id)}
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
      </div>
    </AdminLayout>
  )
}
