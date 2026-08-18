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

  // Creating a term without leaving the editor. Going to /admin/categories to
  // add one and coming back meant losing an unsaved draft, which is a poor
  // trade for a word you already knew you wanted.
  const [newCategory, setNewCategory] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [creating, setCreating] = useState<'category' | 'tag' | null>(null)

  const createCategory = async () => {
    const name = newCategory.trim()

    if (!name || creating) return

    setCreating('category')

    try {
      const res = await api.post<{ category: Category }>('/api/categories', { name })
      const created = res?.category

      if (created) {
        setCategories(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
        // Selected straight away: you created it while filing this post.
        setFormData(prev => ({ ...prev, category_ids: [...prev.category_ids, created.id] }))
        setNewCategory('')
        setAddingCategory(false)
      }
    } catch (error) {
      console.error('Failed to create category:', error)
      alert('Could not create that category. It may already exist.')
    } finally {
      setCreating(null)
    }
  }

  /**
   * Attach tags by name, creating the ones that do not exist yet.
   *
   * Typing is the whole point: having to go and create a tag elsewhere before
   * you can use it is the friction this removes. An existing tag is reused
   * rather than re-created — matched case-insensitively, because "Privacy" and
   * "privacy" are the same tag to everyone except a database.
   */
  const addTags = async (input: string) => {
    const names = input
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)

    if (names.length === 0 || creating) return

    setCreating('tag')

    try {
      for (const name of names) {
        const existing = allTags.find(t => t.name.toLowerCase() === name.toLowerCase())

        if (existing) {
          setFormData(prev =>
            prev.tags.includes(existing.id) ? prev : { ...prev, tags: [...prev.tags, existing.id] }
          )
          continue
        }

        const res = await api.post<{ tag: Tag }>('/api/tags', { name })
        const created = res?.tag

        if (created) {
          setAllTags(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
          setFormData(prev => ({ ...prev, tags: [...prev.tags, created.id] }))
        }
      }

      setNewTag('')
    } catch (error) {
      console.error('Failed to add tags:', error)
      alert('Could not add those tags.')
    } finally {
      setCreating(null)
    }
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

            {/* Categories: a checkbox list, the way every CMS people arrive
                from presents them. Scrolls once there are more than a handful
                rather than pushing the rest of the sidebar off the screen. */}
            <div className="admin-card">
              <h3 className="admin-card-title">Categories</h3>

              {categories.length === 0 ? (
                <p className="admin-term-empty">No categories yet.</p>
              ) : (
                <div className="admin-term-list">
                  {categories.map(cat => (
                    <label key={cat.id} className="admin-term-option">
                      <input
                        type="checkbox"
                        checked={formData.category_ids.includes(cat.id)}
                        onChange={() => handleCategoryToggle(cat.id)}
                      />
                      <span>{cat.name}</span>
                    </label>
                  ))}
                </div>
              )}

              {addingCategory ? (
                <div className="admin-inline-add">
                  <input
                    type="text"
                    className="admin-input"
                    placeholder="New category name"
                    value={newCategory}
                    autoFocus
                    onChange={(e) => setNewCategory(e.target.value)}
                    // Enter must not reach the surrounding form, or adding a
                    // category would submit the post instead.
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') return setAddingCategory(false)
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      createCategory()
                    }}
                  />
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    onClick={createCategory}
                    disabled={!newCategory.trim() || creating !== null}
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="admin-term-add"
                  onClick={() => setAddingCategory(true)}
                >
                  + Add New Category
                </button>
              )}
            </div>

            {/* Tags: typed, not picked. You should not have to create a tag
                somewhere else before you can use it, and a site accumulates far
                too many for a list of every one to stay useful. */}
            <div className="admin-card">
              <h3 className="admin-card-title">Tags</h3>

              <div className="admin-inline-add">
                <input
                  type="text"
                  className="admin-input"
                  placeholder="Add tags, separated by commas"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    // Comma commits too, which is what the placeholder implies.
                    if (e.key !== 'Enter' && e.key !== ',') return
                    e.preventDefault()
                    addTags(newTag)
                  }}
                />
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => addTags(newTag)}
                  disabled={!newTag.trim() || creating !== null}
                >
                  Add
                </button>
              </div>

              {formData.tags.length > 0 && (
                <div className="admin-term-chips">
                  {formData.tags.map(id => {
                    const tag = allTags.find(t => t.id === id)

                    return (
                      <span key={id} className="admin-term-chip">
                        {tag?.name ?? `#${id}`}
                        <button
                          type="button"
                          aria-label={`Remove ${tag?.name ?? 'tag'}`}
                          onClick={() => handleTagToggle(id)}
                        >
                          ×
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}

              {allTags.length > 0 && (
                <details className="admin-term-details">
                  <summary>Choose from existing tags</summary>
                  <div className="admin-term-list">
                    {allTags.map(tag => (
                      <label key={tag.id} className="admin-term-option">
                        <input
                          type="checkbox"
                          checked={formData.tags.includes(tag.id)}
                          onChange={() => handleTagToggle(tag.id)}
                        />
                        <span>{tag.name}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      </form>
    </AdminLayout>
  )
}
