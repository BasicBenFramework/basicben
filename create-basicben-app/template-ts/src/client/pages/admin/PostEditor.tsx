import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from '@basicbenframework/core/client'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import MarkdownEditor from '../../components/MarkdownEditor'

interface Category {
  id: number
  name: string
}

interface Tag {
  id: number
  name: string
}

export default function AdminPostEditor() {
  const navigate = useNavigate()
  const params = useParams()
  const postId = params.id ? parseInt(params.id) : null
  const isEditing = !!postId

  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])

  const [formData, setFormData] = useState({
    title: '',
    content: '',
    excerpt: '',
    slug: '',
    category_id: '',
    tags: [] as number[],
    meta_title: '',
    meta_description: '',
    published: false
  })

  useEffect(() => {
    loadData()
  }, [postId])

  const loadData = async () => {
    try {
      const [catRes, tagRes] = await Promise.all([
        api.get('/api/categories'),
        api.get('/api/tags')
      ])

      setCategories(catRes?.categories || [])
      setAllTags(tagRes?.tags || [])

      if (postId) {
        const postRes = await api.get(`/api/posts/${postId}`)
        const post = postRes?.post
        if (post) {
          setFormData({
            title: post.title || '',
            content: post.content || '',
            excerpt: post.excerpt || '',
            slug: post.slug || '',
            category_id: post.category_id?.toString() || '',
            tags: post.tags?.map((t: Tag) => t.id) || [],
            meta_title: post.meta_title || '',
            meta_description: post.meta_description || '',
            published: post.published || false
          })
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const payload = {
        ...formData,
        category_id: formData.category_id ? parseInt(formData.category_id) : null
      }

      if (isEditing) {
        await api.put(`/api/posts/${postId}`, payload)
      } else {
        await api.post('/api/posts', payload)
      }

      navigate('/admin/posts')
    } catch (error: any) {
      console.error('Failed to save post:', error)
      alert(error.message || 'Failed to save post')
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  const handleTagToggle = (tagId: number) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.includes(tagId)
        ? prev.tags.filter(id => id !== tagId)
        : [...prev.tags, tagId]
    }))
  }

  if (loading) {
    return (
      <AdminLayout title={isEditing ? 'Edit Post' : 'New Post'}>
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={isEditing ? 'Edit Post' : 'New Post'}>
      <form onSubmit={handleSubmit}>
        <div className="admin-grid admin-grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
          {/* Main Content */}
          <div>
            <div className="admin-card">
              <div className="admin-form-group">
                <label className="admin-label">Title</label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleChange}
                  className="admin-input"
                  placeholder="Enter post title"
                  required
                />
              </div>

              <div className="admin-form-group">
                <label className="admin-label">Content</label>
                <MarkdownEditor
                  name="content"
                  value={formData.content}
                  onChange={handleChange}
                  minHeight="400px"
                  placeholder="Write your content here. Markdown is supported."
                  required
                />
              </div>

              <div className="admin-form-group">
                <label className="admin-label">Excerpt</label>
                <textarea
                  name="excerpt"
                  value={formData.excerpt}
                  onChange={handleChange}
                  className="admin-textarea"
                  style={{ minHeight: '100px' }}
                  placeholder="Brief summary of the post"
                />
              </div>
            </div>

            {/* SEO Settings */}
            <div className="admin-card">
              <h3 className="admin-card-title">SEO Settings</h3>
              <div className="admin-form-group">
                <label className="admin-label">Slug</label>
                <input
                  type="text"
                  name="slug"
                  value={formData.slug}
                  onChange={handleChange}
                  className="admin-input"
                  placeholder="post-url-slug"
                />
              </div>

              <div className="admin-form-group">
                <label className="admin-label">Meta Title</label>
                <input
                  type="text"
                  name="meta_title"
                  value={formData.meta_title}
                  onChange={handleChange}
                  className="admin-input"
                  placeholder="SEO title"
                />
              </div>

              <div className="admin-form-group">
                <label className="admin-label">Meta Description</label>
                <textarea
                  name="meta_description"
                  value={formData.meta_description}
                  onChange={handleChange}
                  className="admin-textarea"
                  style={{ minHeight: '80px' }}
                  placeholder="SEO description"
                />
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div>
            {/* Publish */}
            <div className="admin-card">
              <h3 className="admin-card-title">Publish</h3>
              <div className="admin-form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    name="published"
                    checked={formData.published}
                    onChange={handleChange}
                  />
                  Published
                </label>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="submit"
                  className="admin-btn admin-btn-primary"
                  disabled={saving}
                  style={{ flex: 1 }}
                >
                  {saving ? 'Saving...' : (isEditing ? 'Update' : 'Create')}
                </button>
                <a href="/admin/posts" className="admin-btn admin-btn-secondary">
                  Cancel
                </a>
              </div>
            </div>

            {/* Category */}
            <div className="admin-card">
              <h3 className="admin-card-title">Category</h3>
              <select
                name="category_id"
                value={formData.category_id}
                onChange={handleChange}
                className="admin-select"
              >
                <option value="">Select category</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div className="admin-card">
              <h3 className="admin-card-title">Tags</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {allTags.map(tag => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleTagToggle(tag.id)}
                    className={`admin-badge ${formData.tags.includes(tag.id) ? 'admin-badge-info' : ''}`}
                    style={{
                      cursor: 'pointer',
                      border: '1px solid #d1d5db',
                      backgroundColor: formData.tags.includes(tag.id) ? '#dbeafe' : 'white'
                    }}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
              {allTags.length === 0 && (
                <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                  No tags yet. <a href="/admin/tags">Create one</a>
                </p>
              )}
            </div>
          </div>
        </div>
      </form>
    </AdminLayout>
  )
}
