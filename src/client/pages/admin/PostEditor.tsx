import React, { useState, useEffect } from 'react'
import { useAuth, useNavigate, useParams, usePath } from '@basicbenframework/core/client'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import MarkdownEditor from '../../components/MarkdownEditor'
import { excerpt, slugify } from '@basicbenframework/core/content'
import FeaturedImageBox from '../../components/admin/FeaturedImageBox'

import type { AuthorProfile, Page, Post } from '../../../types'
import { Link } from '../../components/Link'

interface Category {
  id: number
  name: string
}

interface Tag {
  id: number
  name: string
}

/**
 * What the server would write as the excerpt, shown as a placeholder.
 *
 * The same function it uses, so the preview cannot promise one summary and
 * store another. Trimmed harder than the stored one: this is a hint in a box,
 * not the summary itself.
 */
function summaryOf(content: string) {
  return excerpt(content || '', 120)
}

/**
 * The editor, for a post or for a page.
 *
 * `/admin/pages/new` has always opened this component, and this component has
 * always saved to `/api/posts` — so creating a page from the Pages screen
 * created a post, which then did not appear in the list you came from. The
 * content type is taken from the path instead, the way the router already
 * distinguishes them, and the boxes that only make sense for a post are hidden
 * for a page: a page has no categories, tags, author byline or excerpt.
 */
export default function AdminPostEditor() {
  const navigate = useNavigate()
  const params = useParams()
  const path = usePath()
  const { user } = useAuth()

  const isPage = path.startsWith('/admin/pages')
  const resource = isPage ? 'pages' : 'posts'
  const noun = isPage ? 'Page' : 'Post'

  const postId = params.id ? parseInt(params.id) : null
  const isEditing = !!postId

  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [authors, setAuthors] = useState<AuthorProfile[]>([])
  // Who the post is filed under when there is no menu to show — the name the
  // API joined for an existing post, or whoever is signed in for a new one.
  const [authorName, setAuthorName] = useState('')

  const [formData, setFormData] = useState({
    title: '',
    content: '',
    excerpt: '',
    slug: '',
    category_ids: [] as number[],
    tags: [] as number[],
    meta_title: '',
    meta_description: '',
    published: false,
    // The media id that gets saved, and the URL that gets shown. The server
    // resolves the second from the first, because only it knows where files
    // are served from.
    featured_image: null as number | null,
    featured_image_url: null as string | null,
    // Empty means "leave it alone": the author menu only appears for people who
    // may reassign, and everyone else must not send a user_id at all.
    user_id: '' as number | ''
  })

  useEffect(() => {
    loadData()
  }, [postId])

  // A new post is yours until somebody reassigns it.
  useEffect(() => {
    if (!isEditing && user?.name) setAuthorName(user.name)
  }, [isEditing, user?.name])

  const loadData = async () => {
    try {
      if (!isPage) await loadPostFurniture()

      if (postId) {
        const res = await api.get<{ post?: Post; page?: Page }>(`/api/${resource}/${postId}`)
        const record = (isPage ? res?.page : res?.post) as (Post & Page) | undefined

        if (record) {
          setFormData(prev => ({
            ...prev,
            title: record.title || '',
            content: record.content || '',
            excerpt: record.excerpt || '',
            slug: record.slug || '',
            category_ids: record.category_ids || [],
            tags: record.tag_ids || record.tags?.map((t: Tag) => t.id) || [],
            meta_title: record.meta_title || '',
            meta_description: record.meta_description || '',
            published: record.published || false,
            featured_image: record.featured_image ?? null,
            featured_image_url: record.featured_image_url ?? null,
            user_id: record.user_id ?? ''
          }))

          if (record.author_name) setAuthorName(record.author_name)
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  /**
   * Categories, tags and the author menu — the boxes only a post has.
   *
   * The author list is refused to anyone who cannot write, so a failure here is
   * an answer rather than an error: no menu, and the post stays attributed to
   * whoever it already belongs to.
   */
  const loadPostFurniture = async () => {
    const [catRes, tagRes] = await Promise.all([
      api.get<{ categories: Category[] }>('/api/categories'),
      api.get<{ tags: Tag[] }>('/api/tags')
    ])

    setCategories(catRes?.categories || [])
    setAllTags(tagRes?.tags || [])

    try {
      const authorRes = await api.get<{ authors: AuthorProfile[] }>('/api/authors')
      setAuthors(authorRes?.authors || [])
    } catch {
      setAuthors([])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      // `featured_image_url` is the server's answer, not the editor's input —
      // sending it back would be asking the API to store a URL in a column that
      // holds a media id.
      const { featured_image_url, user_id, category_ids, tags, excerpt, ...common } = formData

      // category_ids and tags are arrays the server syncs; a page has neither,
      // and no excerpt column to put an excerpt in.
      const payload = isPage
        ? common
        : {
            ...common,
            excerpt,
            category_ids,
            tags,
            // Only when the menu was shown and a choice was made. Sending it
            // otherwise would ask the server to reassign a post to its own
            // author, which it ignores, but there is no reason to ask.
            ...(user_id === '' ? {} : { user_id })
          }

      if (isEditing) {
        await api.put(`/api/${resource}/${postId}`, payload)
      } else {
        await api.post(`/api/${resource}`, payload)
      }

      navigate(`/admin/${resource}`)
    } catch (error: any) {
      console.error(`Failed to save ${resource}:`, error)
      alert(error.message || `Failed to save ${noun.toLowerCase()}`)
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

  // The profile behind the byline, when the list happens to hold it — the
  // avatar is a nicety, and its absence is not worth a request of its own.
  const currentAuthor = authors.find(author => author.id === Number(formData.user_id))

  if (loading) {
    return (
      <AdminLayout title={`${isEditing ? 'Edit' : 'New'} ${noun}`}>
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={`${isEditing ? 'Edit' : 'New'} ${noun}`}>
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
                  placeholder={`Enter ${noun.toLowerCase()} title`}
                  required
                />

                {/* The permalink, where you can see it while writing the title
                    it comes from. It used to live in an SEO panel below the
                    fold, which is a strange place for the post's address.
                    Leaving it blank keeps the placeholder — the slug the
                    server will derive. */}
                <div className="admin-slug">
                  <label htmlFor="slug">Slug</label>
                  <input
                    id="slug"
                    type="text"
                    name="slug"
                    value={formData.slug}
                    onChange={handleChange}
                    className="admin-slug-input"
                    placeholder={slugify(formData.title) || `${noun.toLowerCase()}-url-slug`}
                  />
                  {/* Blank is a request for a fresh one, on an existing post
                      as much as a new one — so the note says the same thing in
                      both cases, because the server does the same thing. */}
                  {!formData.slug.trim() && <span className="admin-slug-note">from the title</span>}
                </div>
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

              {/* Pages have no excerpt column, so the field would have been a
                  box that quietly discarded whatever was typed into it. */}
              {!isPage && (
                <div className="admin-form-group">
                  <label className="admin-label">Excerpt</label>
                  <textarea
                    name="excerpt"
                    value={formData.excerpt}
                    onChange={handleChange}
                    className="admin-textarea"
                    style={{ minHeight: '100px' }}
                    placeholder={summaryOf(formData.content) || 'Written for you from the content if you leave this blank'}
                  />
                </div>
              )}
            </div>

            {/* SEO Settings */}
            <div className="admin-card">
              <h3 className="admin-card-title">SEO Settings</h3>
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
                <Link href={`/admin/${resource}`} className="admin-btn admin-btn-secondary">
                  Cancel
                </Link>
              </div>
            </div>

            {/* Both posts and pages carry one now. A page could only ever get a
                hero image by writing the Markdown for it into the body, which
                puts it in the content rather than beside it. */}
            <FeaturedImageBox
              value={formData.featured_image}
              url={formData.featured_image_url}
              onChange={image =>
                setFormData(prev => ({
                  ...prev,
                  featured_image: image?.id ?? null,
                  featured_image_url: image?.url ?? null
                }))
              }
            />

            {/* Who the post is filed under. Always shown, because "who wrote
                this" is part of what you are editing — but a menu only when
                there is somebody to choose between. Reassigning is `post.edit`:
                an author writes under their own name and nobody else's, so on
                a one-author site, or for an author, this is a statement rather
                than a control. */}
            {!isPage && (
              <div className="admin-card">
                <h3 className="admin-card-title">Author</h3>

                {authors.length > 1 ? (
                  <select
                    name="user_id"
                    value={formData.user_id}
                    onChange={handleChange}
                    className="admin-input"
                  >
                    <option value="">{isEditing ? 'Unchanged' : 'Me'}</option>
                    {authors.map(author => (
                      <option key={author.id} value={author.id}>
                        {author.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="admin-author">
                    {currentAuthor?.avatar_url && (
                      <img src={currentAuthor.avatar_url} alt="" className="admin-author-avatar" />
                    )}
                    <span>{authorName || 'Unknown'}</span>
                  </div>
                )}
              </div>
            )}

            {/* A page has no taxonomy: filing one under a category would put
                it in a listing that only ever shows posts. */}
            {!isPage && (
              <>
                {/* Categories: a checkbox list, the way every CMS people arrive
                    from presents them. Scrolls once there are more than a handful
                    rather than pushing the rest of the sidebar off the screen. */}
                <div className="admin-card">
                  <h3 className="admin-card-title">Categories</h3>

                  {/* What the post is filed under, without scrolling the list
                      to find the ticked boxes. Removable here too, so the
                      common correction does not mean hunting for a checkbox. */}
                  {formData.category_ids.length > 0 && (
                    <div className="admin-term-chips">
                      {formData.category_ids.map(id => {
                        const category = categories.find(c => c.id === id)

                        return (
                          <span key={id} className="admin-term-chip">
                            {category?.name ?? `#${id}`}
                            <button
                              type="button"
                              aria-label={`Remove ${category?.name ?? 'category'}`}
                              onClick={() => handleCategoryToggle(id)}
                            >
                              ×
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  )}

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
              </>
            )}
          </div>
        </div>
      </form>
    </AdminLayout>
  )
}
