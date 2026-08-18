import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from '@basicbenframework/core/client'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import MarkdownEditor from '../../components/MarkdownEditor'

import type { Post } from '../../../types'
import { Link } from '../../components/Link'

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
    category_ids: [] as number[],
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
        api.get<{ categories: Category[] }>('/api/categories'),
        api.get<{ tags: Tag[] }>('/api/tags')
      ])

      setCategories(catRes?.categories || [])
      setAllTags(tagRes?.tags || [])

      if (postId) {
        const postRes = await api.get<{ post: Post }>(`/api/posts/${postId}`)
        const post = postRes?.post
        if (post) {
          setFormData({
            title: post.title || '',
            content: post.content || '',
            excerpt: post.excerpt || '',
            slug: post.slug || '',
            category_ids: post.category_ids || [],
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
      // Sent as-is: category_ids and tags are both arrays the server syncs.
      const payload = { ...formData }

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

  const handleCategoryToggle = (categoryId: number) => {
    setFormData(prev => ({
      ...prev,
      category_ids: prev.category_ids.includes(categoryId)
        ? prev.category_ids.filter(id => id !== categoryId)
        : [...prev.category_ids, categoryId]
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
                <Link href="/admin/posts" className="admin-btn admin-btn-secondary">
                  Cancel
                </Link>
              </div>
            </div>

            {/* Categories. A post can have several, as it can in every CMS
                people arrive from — the first is treated as the primary one. */}
            <div className="admin-card">
              <h3 className="admin-card-title">Categories</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleCategoryToggle(cat.id)}
                    className={`admin-badge ${formData.category_ids.includes(cat.id) ? 'admin-badge-info' : ''}`}
                    style={{
                      cursor: 'pointer',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: formData.category_ids.includes(cat.id) ? 'var(--tint-info)' : 'var(--surface)'
                    }}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
              {categories.length === 0 && (
                <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem' }}>
                  No categories yet. <Link href="/admin/categories">Create one</Link>
                </p>
              )}
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
                      border: '1px solid var(--border-strong)',
                      backgroundColor: formData.tags.includes(tag.id) ? 'var(--tint-info)' : 'var(--surface)'
                    }}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
              {allTags.length === 0 && (
                <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem' }}>
                  No tags yet. <Link href="/admin/tags">Create one</Link>
                </p>
              )}
            </div>
          </div>
        </div>
      </form>
    </AdminLayout>
  )
}
