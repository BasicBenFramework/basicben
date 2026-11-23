import React, { useState, useEffect, useRef } from 'react'
import { useAuth, useNavigate, useParams, usePath } from '@basicbenframework/core/client'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import MarkdownEditor from '../../components/MarkdownEditor'
import { excerpt, slugify } from '@basicbenframework/core/content'
import FeaturedImageBox from '../../components/admin/FeaturedImageBox'
import TermPicker from '../../components/admin/TermPicker'
import SnippetPicker from '../../components/admin/SnippetPicker'
import { usePostLock } from '../../hooks/usePostLock'
import { useContentTypes, typeFromQuery, navigateWithType } from '../../hooks/useContentTypes'
import { CustomFieldsPanel, CustomTermsPanel } from '../../components/admin/ContentModelPanels'

import type { AuthorProfile, Page, Post } from '../../../types'
import { Link } from '../../components/Link'
import { can } from '@basicbenframework/core/auth/permissions'

type Status = 'draft' | 'pending' | 'published'

interface Revision {
  id: number
  title: string
  author_name?: string | null
  autosave: number
  created_at: string
}

interface Autosave {
  id: number
  title: string
  content: string
  excerpt: string | null
  created_at: string
}

/** How often an unsaved change is autosaved, in milliseconds. */
const AUTOSAVE_EVERY = 30_000

/** A stored UTC timestamp as the value a datetime-local input wants. */
function toLocalInput(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(/Z|[+-]\d\d:?\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

/** A datetime-local value, which is local time, as ISO UTC for the server. */
function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

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

  // Content types (Phase 3): a post may be a recipe, a product... The type
  // comes from the saved post, or `?type=` for a new one; its `supports`
  // decide which panels show, and its fields get a panel of their own.
  const { types: contentTypes } = useContentTypes()
  const [postType, setPostType] = useState(typeFromQuery() || 'post')
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({})
  const [termIds, setTermIds] = useState<number[]>([])
  const [termsReady, setTermsReady] = useState(false)
  const contentType = contentTypes.find(type => type.key === postType)
  // Until types load, everything shows: the editor as it was before types.
  const supports = (panel: keyof NonNullable<typeof contentType>['supports']) => isPage || !contentType || contentType.supports[panel]

  const noun = isPage ? 'Page' : (contentType?.singular_label ?? 'Post')

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
    // Posts only. Pages keep the published checkbox; they are not reviewed or
    // scheduled.
    status: 'draft' as Status,
    // Local time, as the datetime-local input holds it. Blank means "now" when
    // publishing, and leaves an already-live post's date alone.
    publish_at: '',
    og_title: '',
    og_description: '',
    og_image: null as number | null,
    og_image_url: null as string | null,
    twitter_title: '',
    twitter_description: '',
    canonical_url: '',
    noindex: false,
    // The media id that gets saved, and the URL that gets shown. The server
    // resolves the second from the first, because only it knows where files
    // are served from.
    featured_image: null as number | null,
    featured_image_url: null as string | null,
    // Empty means "leave it alone": the author menu only appears for people who
    // may reassign, and everyone else must not send a user_id at all.
    user_id: '' as number | ''
  })

  const [revisions, setRevisions] = useState<Revision[]>([])
  const [autosave, setAutosave] = useState<Autosave | null>(null)
  const [lastAutosaved, setLastAutosaved] = useState<string | null>(null)
  // Whether the form differs from what was last saved, so autosave only
  // writes when there is something to keep.
  const dirty = useRef(false)

  const mayPublish = can(user as { role?: string; email_verified?: boolean } | null, 'post.publish')

  // The soft edit lock, for an existing post. A new post has no id to lock and
  // nobody else can have it open; pages are another controller's and unlocked.
  const lock = usePostLock(postId, !isPage && isEditing)
  const lockedOut = !lock.canSave

  useEffect(() => {
    loadData()
  }, [postId])

  // Autosave an existing post while it is being edited. A new post has no id
  // to autosave against until its first save.
  useEffect(() => {
    if (isPage || !postId) return

    const timer = setInterval(async () => {
      if (!dirty.current || lockedOut) return
      dirty.current = false
      try {
        const res = await api.put<{ autosave: { created_at: string } }>(`/api/posts/${postId}/autosave`, {
          title: formData.title,
          content: formData.content,
          excerpt: formData.excerpt
        })
        setLastAutosaved(res?.autosave?.created_at ?? new Date().toISOString())
      } catch (error) {
        dirty.current = true
        // Refused because someone else holds the lock: find out who, so the
        // banner appears instead of autosave failing quietly every 30 seconds.
        if (/is editing this post/.test((error as Error).message)) void lock.retry()
      }
    }, AUTOSAVE_EVERY)

    return () => clearInterval(timer)
  }, [isPage, postId, formData.title, formData.content, formData.excerpt, lockedOut])

  /**
   * Take the lock from whoever has it.
   *
   * Opening a post someone else is in shows their last *saved* text, which
   * may be behind what they are about to save — so after taking over the post
   * is reloaded, to edit what is really there. If the lock was taken from us
   * mid-edit, the opposite: what is on screen is our unsaved work, and taking
   * the lock back is choosing to keep it, so it is left alone.
   */
  const takeOver = async () => {
    const reload = !lock.lostIt
    await lock.takeOver()
    if (reload) await loadData()
  }

  /** The other editor has left: load what they saved, then take the lock. */
  const reloadAndEdit = async () => {
    await loadData()
    await lock.retry()
  }

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // A new post is yours until somebody reassigns it.
  useEffect(() => {
    if (!isEditing && user?.name) setAuthorName(user.name)
  }, [isEditing, user?.name])

  const loadData = async () => {
    try {
      if (!isPage) await loadPostFurniture()

      if (postId) {
        const res = await api.get<{ post?: Post; page?: Page; autosave?: Autosave | null }>(`/api/${resource}/${postId}`)
        const record = (isPage ? res?.page : res?.post) as (Post & Page) | undefined

        if (!isPage) {
          setAutosave(res?.autosave ?? null)
          loadRevisions()
        }

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
            published: Boolean(record.published),
            status: (record.status as Status) || (record.published ? 'published' : 'draft'),
            publish_at: toLocalInput(record.publish_at),
            og_title: record.og_title || '',
            og_description: record.og_description || '',
            og_image: record.og_image ?? null,
            og_image_url: null,
            twitter_title: record.twitter_title || '',
            twitter_description: record.twitter_description || '',
            canonical_url: record.canonical_url || '',
            noindex: Boolean(Number(record.noindex ?? 0)),
            featured_image: record.featured_image ?? null,
            featured_image_url: record.featured_image_url ?? null,
            user_id: record.user_id ?? ''
          }))

          if (record.author_name) setAuthorName(record.author_name)

          if (!isPage) {
            setPostType(record.post_type || 'post')
            setCustomFields(record.fields && typeof record.fields === 'object' ? record.fields : {})
            setTermIds(record.term_ids || [])
          }
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

  const loadRevisions = async () => {
    if (!postId) return
    try {
      const res = await api.get<{ revisions: Revision[] }>(`/api/posts/${postId}/revisions`)
      setRevisions((res?.revisions || []).filter(revision => !revision.autosave))
    } catch {
      setRevisions([])
    }
  }

  /** Put the autosaved text back into the form. Saving is still a separate step. */
  const restoreAutosave = () => {
    if (!autosave) return
    setFormData(prev => ({
      ...prev,
      title: autosave.title,
      content: autosave.content,
      excerpt: autosave.excerpt || ''
    }))
    dirty.current = true
    setAutosave(null)
  }

  const restoreRevision = async (revision: Revision) => {
    if (!postId) return
    if (!confirm(`Replace the current text with the version from ${new Date(revision.created_at).toLocaleString()}? The current text is kept as a revision.`)) return
    try {
      await api.post(`/api/posts/${postId}/revisions/${revision.id}/restore`, {})
      await loadData()
    } catch (error: any) {
      alert(error.message || 'Could not restore that revision')
    }
  }

  const handleSubmit = async (e: React.FormEvent, submitStatus?: Status) => {
    e.preventDefault()
    setSaving(true)

    try {
      // `featured_image_url` is the server's answer, not the editor's input —
      // sending it back would be asking the API to store a URL in a column that
      // holds a media id.
      const {
        featured_image_url, og_image_url, user_id, category_ids, tags, excerpt,
        status, publish_at, published, ...common
      } = formData

      const finalStatus = submitStatus ?? status

      // category_ids and tags are arrays the server syncs; a page has neither,
      // and no excerpt column to put an excerpt in. A page publishes with the
      // checkbox; a post with its status and an optional schedule.
      const payload = isPage
        ? { ...common, published }
        : {
            ...common,
            status: finalStatus,
            // Sent only when there is one: blank means "now" for a post going
            // live, and "unchanged" for one already live.
            ...(publish_at ? { publish_at: fromLocalInput(publish_at) } : {}),
            excerpt,
            category_ids,
            tags,
            // Only when the menu was shown and a choice was made. Sending it
            // otherwise would ask the server to reassign a post to its own
            // author, which it ignores, but there is no reason to ask.
            ...(user_id === '' ? {} : { user_id }),
            post_type: postType,
            // Only for a type that has fields, and terms only once the
            // pickers know the selection: an unloaded box is not "none".
            ...(contentType?.supports.custom_fields && contentType.fields.length ? { fields: customFields } : {}),
            ...(termsReady ? { term_ids: termIds } : {})
          }

      if (isEditing) {
        await api.put(`/api/${resource}/${postId}`, payload)
      } else {
        await api.post(`/api/${resource}`, payload)
      }

      dirty.current = false
      navigateWithType(navigate, `/admin/${resource}`, isPage ? null : postType)
    } catch (error: any) {
      console.error(`Failed to save ${resource}:`, error)
      // Refused by the edit lock: refresh it so the banner shows who has it.
      if (/is editing this post/.test(error?.message ?? '')) void lock.retry()
      alert(error.message || `Failed to save ${noun.toLowerCase()}`)
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked

    // Someone else holds the lock: the form is for reading until it is ours.
    // Toolbar edits arrive here too, so this covers them as well as typing.
    if (lockedOut) return

    dirty.current = true
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  // What the main button will do, so its label can say so.
  const scheduledFor = formData.publish_at ? new Date(formData.publish_at) : null
  const isFuture = Boolean(scheduledFor && scheduledFor.getTime() > Date.now())
  const submitLabel = saving
    ? 'Saving...'
    : isPage
      ? (isEditing ? 'Update' : 'Create')
      : formData.status === 'published'
        ? (isFuture ? 'Schedule' : (isEditing ? 'Update' : 'Publish'))
        : formData.status === 'pending'
          ? 'Submit for review'
          : 'Save draft'

  // Creating a term without leaving the editor. Going to /admin/categories to
  // add one and coming back meant losing an unsaved draft, which is a poor
  // trade for a word you already knew you wanted.
  const [creating, setCreating] = useState<'category' | 'tag' | null>(null)

  // Whether it landed, so the field knows to clear itself — a name that was
  // refused stays in the box to be corrected rather than vanishing behind an
  // alert.
  const createCategory = async (name: string) => {
    if (!name || creating) return false

    setCreating('category')

    try {
      const res = await api.post<{ category: Category }>('/api/categories', { name })
      const created = res?.category

      if (created) {
        setCategories(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
        // Selected straight away: you created it while filing this post.
        setFormData(prev => ({ ...prev, category_ids: [...prev.category_ids, created.id] }))
      }

      return Boolean(created)
    } catch (error) {
      console.error('Failed to create category:', error)
      alert('Could not create that category. It may already exist.')
      return false
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

    if (names.length === 0 || creating) return false

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

      return true
    } catch (error) {
      console.error('Failed to add tags:', error)
      alert('Could not add those tags.')
      return false
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
        {/* The edit lock. Shown above everything, because it decides whether
            anything below can be saved. */}
        {lock.status === 'blocked' && (
          <div className="admin-card" role="alert" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', borderColor: 'var(--warning)', background: 'var(--tint-warning)' }}>
            <span>
              {lock.lostIt
                ? <><strong>{lock.holder}</strong> has taken over editing this post. Your unsaved changes are still on screen, but cannot be saved unless you take it back.</>
                : <><strong>{lock.holder}</strong> is editing this post. You can read it, but saving is paused so neither of you overwrites the other.</>}
            </span>
            <span style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="admin-btn admin-btn-primary" onClick={takeOver}>Take over</button>
              <Link href="/admin/posts" className="admin-btn admin-btn-secondary">Back to posts</Link>
            </span>
          </div>
        )}
        {lock.status === 'free' && (
          <div className="admin-card" role="status" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{lock.holder || 'The other editor'} has finished editing. Reload to see their changes and start editing.</span>
            <button type="button" className="admin-btn admin-btn-primary" onClick={reloadAndEdit}>Reload and edit</button>
          </div>
        )}
        {autosave && (
          <div className="admin-card" role="status" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              There is an autosave of this post from {new Date(autosave.created_at).toLocaleString()} that is newer than the saved version.
            </span>
            <span style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="admin-btn admin-btn-primary" onClick={restoreAutosave}>Restore it</button>
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setAutosave(null)}>Dismiss</button>
            </span>
          </div>
        )}
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
                  readOnly={lockedOut}
                  tools={(insert, disabled) => <SnippetPicker onInsert={insert} disabled={disabled} />}
                />
              </div>

              {/* Pages have no excerpt column, so the field would have been a
                  box that quietly discarded whatever was typed into it. */}
              {!isPage && supports('excerpt') && (
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

            {!isPage && (
              <CustomFieldsPanel
                type={contentType}
                values={customFields}
                disabled={lockedOut}
                onChange={values => {
                  dirty.current = true
                  setCustomFields(values)
                }}
              />
            )}

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

              <div className="admin-form-group">
                <label className="admin-label">Canonical URL</label>
                <input
                  type="url"
                  name="canonical_url"
                  value={formData.canonical_url}
                  onChange={handleChange}
                  className="admin-input"
                  placeholder="Only if this was first published somewhere else"
                />
              </div>

              <div className="admin-form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" name="noindex" checked={formData.noindex} onChange={handleChange} />
                  Ask search engines not to index this {noun.toLowerCase()}
                </label>
              </div>
            </div>

            {/* What a shared link shows. Blank fields fall back — to the SEO
                fields, then the title, excerpt and featured image — so most
                posts never need these. */}
            <div className="admin-card">
              <h3 className="admin-card-title">Social cards</h3>
              <div className="admin-form-group">
                <label className="admin-label">Open Graph title</label>
                <input type="text" name="og_title" value={formData.og_title} onChange={handleChange} className="admin-input" placeholder={formData.meta_title || formData.title || 'Falls back to the SEO title'} />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Open Graph description</label>
                <textarea name="og_description" value={formData.og_description} onChange={handleChange} className="admin-textarea" style={{ minHeight: '60px' }} placeholder={formData.meta_description || 'Falls back to the SEO description'} />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Twitter / X title</label>
                <input type="text" name="twitter_title" value={formData.twitter_title} onChange={handleChange} className="admin-input" placeholder="Falls back to the Open Graph title" />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Twitter / X description</label>
                <textarea name="twitter_description" value={formData.twitter_description} onChange={handleChange} className="admin-textarea" style={{ minHeight: '60px' }} placeholder="Falls back to the Open Graph description" />
              </div>
            </div>

            {!isPage && isEditing && revisions.length > 0 && (
              <div className="admin-card">
                <h3 className="admin-card-title">Revisions</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
                  {revisions.slice(0, 20).map(revision => (
                    <li key={revision.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                      <span>
                        {new Date(revision.created_at).toLocaleString()}
                        {revision.author_name ? ` — ${revision.author_name}` : ''}
                        <br />
                        <small style={{ color: 'var(--fg-muted)' }}>{revision.title}</small>
                      </span>
                      <button type="button" className="admin-btn admin-btn-secondary" onClick={() => restoreRevision(revision)}>
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div>
            {/* Publish */}
            <div className="admin-card">
              <h3 className="admin-card-title">Publish</h3>
              {isPage ? (
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
              ) : (
                <>
                  <div className="admin-form-group">
                    <label className="admin-label" htmlFor="status">Status</label>
                    {/* A contributor can ask for review but not publish; the
                        option is shown disabled so the route to going live is
                        visible rather than missing. */}
                    <select id="status" name="status" value={formData.status} onChange={handleChange} className="admin-input">
                      <option value="draft">Draft</option>
                      <option value="pending">Pending review</option>
                      <option value="published" disabled={!mayPublish && formData.status !== 'published'}>
                        Published{mayPublish ? '' : ' (an editor publishes)'}
                      </option>
                    </select>
                  </div>

                  {formData.status === 'published' && (
                    <div className="admin-form-group">
                      <label className="admin-label" htmlFor="publish_at">Publish on</label>
                      <input
                        id="publish_at"
                        type="datetime-local"
                        name="publish_at"
                        value={formData.publish_at}
                        onChange={handleChange}
                        className="admin-input"
                      />
                      <small style={{ color: 'var(--fg-muted)' }}>
                        {isFuture
                          ? `Scheduled — goes live ${scheduledFor!.toLocaleString()}.`
                          : formData.publish_at
                            ? 'Already live.'
                            : 'Blank publishes now. A future date schedules it.'}
                      </small>
                    </div>
                  )}

                  {lastAutosaved && (
                    <p style={{ color: 'var(--fg-muted)', fontSize: '0.8rem' }}>
                      Autosaved {new Date(lastAutosaved).toLocaleTimeString()}
                    </p>
                  )}
                </>
              )}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="submit"
                  className="admin-btn admin-btn-primary"
                  disabled={saving || lockedOut}
                  title={lockedOut ? 'Someone else is editing this post' : undefined}
                  style={{ flex: 1 }}
                >
                  {submitLabel}
                </button>
                <Link href={`/admin/${resource}`} className="admin-btn admin-btn-secondary">
                  Cancel
                </Link>
              </div>
            </div>

            {/* Both posts and pages carry one now. A page could only ever get a
                hero image by writing the Markdown for it into the body, which
                puts it in the content rather than beside it. */}
            {supports('featured_image') && <FeaturedImageBox
              value={formData.featured_image}
              url={formData.featured_image_url}
              onChange={image => {
                dirty.current = true
                setFormData(prev => ({
                  ...prev,
                  featured_image: image?.id ?? null,
                  featured_image_url: image?.url ?? null
                }))
              }}
            />}

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
                it in a listing that only ever shows posts.

                Both boxes are the same control: search what exists, tick what
                you want, and add what is missing from the field you searched
                in. They used to differ — categories were a checkbox list with
                an add button, tags a free-text field with the list folded away
                behind a disclosure — which meant two ways to do one thing and
                neither of them usable on a site with four hundred tags. */}
            {!isPage && (
              <>
                {supports('categories') && <TermPicker
                  title="Categories"
                  noun="category"
                  terms={categories}
                  selected={formData.category_ids}
                  onToggle={handleCategoryToggle}
                  onAdd={createCategory}
                  busy={creating !== null}
                  emptyText="No categories yet."
                />}

                {/* A comma commits, because a run of tags is conventionally
                    typed as one — and `addTags` splits it, reusing the ones
                    that already exist rather than making near-duplicates. */}
                {supports('tags') && <TermPicker
                  title="Tags"
                  noun="tag"
                  terms={allTags}
                  selected={formData.tags}
                  onToggle={handleTagToggle}
                  onAdd={addTags}
                  busy={creating !== null}
                  emptyText="No tags yet."
                  commitOnComma
                />}

                <CustomTermsPanel
                  typeKey={postType}
                  selected={termIds}
                  onChange={ids => {
                    dirty.current = true
                    setTermIds(ids)
                  }}
                  onReady={setTermsReady}
                />
              </>
            )}
          </div>
        </div>
      </form>
    </AdminLayout>
  )
}
