import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface Tag {
  id: number
  name: string
  slug: string
  post_count?: number
}

export default function AdminTags() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formData, setFormData] = useState({ name: '', slug: '' })

  useEffect(() => {
    loadTags()
  }, [])

  const loadTags = async () => {
    try {
      const res = await api.get('/api/tags')
      setTags(res?.tags || [])
    } catch (error) {
      console.error('Failed to load tags:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      if (editingId) {
        await api.put(`/api/tags/${editingId}`, formData)
      } else {
        await api.post('/api/tags', formData)
      }

      setFormData({ name: '', slug: '' })
      setEditingId(null)
      loadTags()
    } catch (error: any) {
      alert(error.message || 'Failed to save tag')
    }
  }

  const handleEdit = (tag: Tag) => {
    setFormData({ name: tag.name, slug: tag.slug })
    setEditingId(tag.id)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this tag?')) return

    try {
      await api.delete(`/api/tags/${id}`)
      setTags(tags.filter(t => t.id !== id))
    } catch (error) {
      alert('Failed to delete tag')
    }
  }

  const handleCancel = () => {
    setFormData({ name: '', slug: '' })
    setEditingId(null)
  }

  if (loading) {
    return (
      <AdminLayout title="Tags">
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Tags">
      <div className="admin-grid admin-grid-2">
        {/* Form */}
        <div className="admin-card">
          <h3 className="admin-card-title">
            {editingId ? 'Edit Tag' : 'Add New Tag'}
          </h3>
          <form onSubmit={handleSubmit}>
            <div className="admin-form-group">
              <label className="admin-label">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="admin-input"
                placeholder="Tag name"
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
                placeholder="tag-slug (auto-generated if empty)"
              />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="admin-btn admin-btn-primary">
                {editingId ? 'Update' : 'Add Tag'}
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
          <h3 className="admin-card-title">All Tags</h3>
          {tags.length === 0 ? (
            <p style={{ color: '#6b7280' }}>No tags yet.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {tags.map(tag => (
                <div
                  key={tag.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 1rem',
                    backgroundColor: '#f3f4f6',
                    borderRadius: '0.375rem'
                  }}
                >
                  <span>{tag.name}</span>
                  <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                    ({tag.post_count || 0})
                  </span>
                  <button
                    onClick={() => handleEdit(tag)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem' }}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDelete(tag.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem' }}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  )
}
