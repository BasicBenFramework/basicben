import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import { Link } from '../../components/Link'
import { Pagination, type PageMeta } from '../../components/admin/Pagination'

interface Post {
  id: number
  title: string
  published: boolean | number
  status?: 'draft' | 'pending' | 'published'
  publish_at?: string | null
  deleted_at?: string | null
  created_at: string
  /** Joined by the listing. An editor sees everyone's posts, so it matters. */
  author_name?: string
  categories?: Array<{ id: number; name: string; slug: string }>
}

type Filter = 'all' | 'draft' | 'pending' | 'scheduled' | 'published' | 'trash'

const TABS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'pending', label: 'Pending review' },
  { key: 'draft', label: 'Drafts' },
  { key: 'trash', label: 'Trash' }
]

/** Read a stored timestamp as UTC, whether or not the driver kept the zone. */
function parseUtc(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(/Z|[+-]\d\d:?\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? null : date
}

/** The badge a row shows: its status, with "scheduled" told apart from live. */
function badgeFor(post: Post): { label: string; tone: string } {
  if (post.deleted_at) return { label: 'Trashed', tone: 'admin-badge-danger' }
  const at = parseUtc(post.publish_at)
  if (Number(post.published) && at && at.getTime() > Date.now()) {
    return { label: `Scheduled ${at.toLocaleString()}`, tone: 'admin-badge-info' }
  }
  if (Number(post.published)) return { label: 'Published', tone: 'admin-badge-success' }
  if (post.status === 'pending') return { label: 'Pending review', tone: 'admin-badge-warning' }
  return { label: 'Draft', tone: 'admin-badge-warning' }
}

export default function AdminPosts() {
  const [posts, setPosts] = useState<Post[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [counts, setCounts] = useState<Partial<Record<Filter, number>>>({})
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPosts()
  }, [page, filter, query])

  const loadPosts = async () => {
    setLoading(true)
    setSelected([])

    try {
      const params = new URLSearchParams({ page: String(page), status: filter })
      if (query) params.set('search', query)
      const res = await api.get<{ posts: Post[]; meta: PageMeta; counts: Record<Filter, number> }>(`/api/posts?${params}`)
      setPosts(res?.posts || [])
      setMeta(res?.meta || null)
      setCounts(res?.counts || {})
    } catch (error) {
      console.error('Failed to load posts:', error)
    } finally {
      setLoading(false)
    }
  }

  const changeFilter = (next: Filter) => {
    setFilter(next)
    setPage(1)
  }

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setPage(1)
    setQuery(search.trim())
  }

  /**
   * Reload after a change rather than splicing rows out. The page is a window
   * on the server's ordering, so removing a row locally leaves it one short and
   * silently hides whatever should have moved up into it. Stepping back a page
   * when the last rows on it go keeps the table from showing empty.
   */
  const refreshAfter = (removed: number) => {
    if (removed >= posts.length && page > 1) setPage(page - 1)
    else loadPosts()
  }

  const runBulk = async (action: string, ids: number[]) => {
    if (ids.length === 0) return
    if (action === 'delete' && !confirm(`Delete ${ids.length} post${ids.length === 1 ? '' : 's'} permanently? This cannot be undone.`)) return

    try {
      const res = await api.post<{ done: number[]; failed: Array<{ id: number; error: string }> }>('/api/posts/bulk', { action, ids })
      if (res?.failed?.length) {
        alert(`${res.failed.length} could not be changed:\n` + res.failed.map(f => `#${f.id}: ${f.error}`).join('\n'))
      }
      const leavesView = action === 'trash' || action === 'restore' || action === 'delete' || filter !== 'all'
      refreshAfter(leavesView ? (res?.done?.length ?? 0) : 0)
    } catch (error: any) {
      alert(error.message || 'That action failed')
    }
  }

  const trash = async (id: number) => {
    try {
      await api.delete(`/api/posts/${id}`)
      refreshAfter(1)
    } catch (error: any) {
      alert(error.message || 'Failed to move the post to the trash')
    }
  }

  const toggle = (id: number) =>
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  const allSelected = posts.length > 0 && selected.length === posts.length
  const inTrash = filter === 'trash'

  return (
    <AdminLayout title="Posts">
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Posts</h2>
          <Link href="/admin/posts/new" className="admin-btn admin-btn-primary">
            + New Post
          </Link>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <nav aria-label="Filter posts by status" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
            {TABS.map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => changeFilter(tab.key)}
                className={`admin-btn ${filter === tab.key ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
                aria-pressed={filter === tab.key}
              >
                {tab.label}{counts[tab.key] !== undefined ? ` (${counts[tab.key]})` : ''}
              </button>
            ))}
          </nav>

          <form onSubmit={submitSearch} role="search" style={{ display: 'flex', gap: '0.25rem' }}>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search posts"
              className="admin-input"
              aria-label="Search posts"
            />
            <button type="submit" className="admin-btn admin-btn-secondary">Search</button>
          </form>
        </div>

        {selected.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span>{selected.length} selected</span>
            {inTrash ? (
              <>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => runBulk('restore', selected)}>Restore</button>
                <button type="button" className="admin-btn admin-btn-danger" onClick={() => runBulk('delete', selected)}>Delete permanently</button>
              </>
            ) : (
              <>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => runBulk('publish', selected)}>Publish</button>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => runBulk('draft', selected)}>Unpublish</button>
                <button type="button" className="admin-btn admin-btn-danger" onClick={() => runBulk('trash', selected)}>Move to trash</button>
              </>
            )}
          </div>
        )}

        {loading ? (
          <div className="admin-loading">Loading...</div>
        ) : posts.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)', textAlign: 'center', padding: '2rem' }}>
            {query
              ? `No posts match “${query}”.`
              : inTrash
                ? 'The trash is empty.'
                : filter === 'all'
                  ? 'No posts yet. Create your first post!'
                  : 'Nothing here.'}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: '2rem' }}>
                  <input
                    type="checkbox"
                    aria-label="Select all posts on this page"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : posts.map(p => p.id))}
                  />
                </th>
                <th>Title</th>
                <th>Author</th>
                <th>Categories</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map(post => {
                const badge = badgeFor(post)
                const date = parseUtc(post.publish_at) ?? parseUtc(post.created_at)
                return (
                  <tr key={post.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${post.title}`}
                        checked={selected.includes(post.id)}
                        onChange={() => toggle(post.id)}
                      />
                    </td>
                    <td>
                      {inTrash ? (
                        <span style={{ fontWeight: 500 }}>{post.title}</span>
                      ) : (
                        <Link href={`/admin/posts/${post.id}/edit`} style={{ color: 'var(--accent)', fontWeight: 500 }}>
                          {post.title}
                        </Link>
                      )}
                    </td>
                    <td>{post.author_name || '—'}</td>
                    <td>
                      {post.categories?.length
                        ? post.categories.map(c => c.name).join(', ')
                        : '—'}
                    </td>
                    <td>
                      <span className={`admin-badge ${badge.tone}`}>{badge.label}</span>
                    </td>
                    <td>{date ? date.toLocaleDateString() : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {inTrash ? (
                          <>
                            <button onClick={() => runBulk('restore', [post.id])} className="admin-btn admin-btn-secondary">
                              Restore
                            </button>
                            <button onClick={() => runBulk('delete', [post.id])} className="admin-btn admin-btn-danger">
                              Delete permanently
                            </button>
                          </>
                        ) : (
                          <>
                            <Link href={`/admin/posts/${post.id}/edit`} className="admin-btn admin-btn-secondary">
                              Edit
                            </Link>
                            <button onClick={() => trash(post.id)} className="admin-btn admin-btn-danger">
                              Trash
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {meta && <Pagination meta={meta} onChange={setPage} noun="posts" />}
      </div>
    </AdminLayout>
  )
}
