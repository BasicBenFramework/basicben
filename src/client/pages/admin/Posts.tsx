import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api.ts'
import AdminLayout from '../../layouts/AdminLayout.tsx'
import { Link } from '../../components/Link.tsx'
import { Pagination, type PageMeta } from '../../components/admin/Pagination.tsx'
import { useNavigate, useParams } from '@basicbenframework/core/client'
import { useContentTypes, typeFromQuery, navigateWithType } from '../../hooks/useContentTypes.ts'
import { t, useT } from '../../i18n/index.ts'

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

const TABS: Filter[] = ['all', 'published', 'scheduled', 'pending', 'draft', 'trash']

/** Read a stored timestamp as UTC, whether or not the driver kept the zone. */
function parseUtc(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(/Z|[+-]\d\d:?\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? null : date
}

/** The badge a row shows: its status, with "scheduled" told apart from live. */
function badgeFor(post: Post): { label: string; tone: string } {
  if (post.deleted_at) return { label: t('Trashed'), tone: 'admin-badge-danger' }
  const at = parseUtc(post.publish_at)
  if (Number(post.published) && at && at.getTime() > Date.now()) {
    return { label: t('Scheduled {date}', { date: at.toLocaleString() }), tone: 'admin-badge-info' }
  }
  if (Number(post.published)) return { label: t('Published'), tone: 'admin-badge-success' }
  if (post.status === 'pending') return { label: t('Pending review'), tone: 'admin-badge-warning' }
  return { label: t('Draft'), tone: 'admin-badge-warning' }
}

export default function AdminPosts() {
  const { t, tn } = useT()
  const tabLabels: Record<Filter, string> = {
    all: t('All'),
    published: t('Published'),
    scheduled: t('Scheduled'),
    pending: t('Pending review'),
    draft: t('Drafts'),
    trash: t('Trash')
  }
  const [posts, setPosts] = useState<Post[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [counts, setCounts] = useState<Partial<Record<Filter, number>>>({})
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(true)

  // Which content type this screen lists. `/admin/content/:type` names it in
  // the path; `/admin/posts?type=` in the query; otherwise it is Posts.
  const navigate = useNavigate()
  const params = useParams() as { type?: string }
  const { types } = useContentTypes()
  const [type, setType] = useState(params.type || typeFromQuery() || 'post')
  useEffect(() => { if (params.type) setType(params.type) }, [params.type])
  const current = types.find(ct => ct.key === type)
  const plural = current?.plural_label ?? t('Posts')

  const changeType = (next: string) => {
    setType(next)
    setPage(1)
    // Kept in the address bar so a reload stays on the same type.
    window.history.replaceState({}, '', next === 'post' ? '/admin/posts' : `/admin/posts?type=${encodeURIComponent(next)}`)
  }

  useEffect(() => {
    loadPosts()
  }, [page, filter, query, type])

  const loadPosts = async () => {
    setLoading(true)
    setSelected([])

    try {
      const params = new URLSearchParams({ page: String(page), status: filter, type })
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
    if (action === 'delete' && !confirm(tn('Delete {count} post permanently? This cannot be undone.', 'Delete {count} posts permanently? This cannot be undone.', ids.length))) return

    try {
      const res = await api.post<{ done: number[]; failed: Array<{ id: number; error: string }> }>('/api/posts/bulk', { action, ids })
      if (res?.failed?.length) {
        alert(tn('{count} could not be changed:', '{count} could not be changed:', res.failed.length) + '\n' + res.failed.map(f => `#${f.id}: ${f.error}`).join('\n'))
      }
      const leavesView = action === 'trash' || action === 'restore' || action === 'delete' || filter !== 'all'
      refreshAfter(leavesView ? (res?.done?.length ?? 0) : 0)
    } catch (error: any) {
      alert(error.message || t('That action failed'))
    }
  }

  const trash = async (id: number) => {
    try {
      await api.delete(`/api/posts/${id}`)
      refreshAfter(1)
    } catch (error: any) {
      alert(error.message || t('Failed to move the post to the trash'))
    }
  }

  const toggle = (id: number) =>
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  const allSelected = posts.length > 0 && selected.length === posts.length
  const inTrash = filter === 'trash'

  return (
    <AdminLayout
      title={plural}
      actions={type === 'post' ? (
        <Link href="/admin/posts/new" className="admin-btn admin-btn-primary">
          {t('+ New Post')}
        </Link>
      ) : (
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => navigateWithType(navigate, '/admin/posts/new', type)}>
          {current?.singular_label ? t('+ New {name}', { name: current.singular_label }) : t('+ New entry')}
        </button>
      )}
    >
      <div className="admin-card">
        {/* One content type at a time. Shown only once a site has more than
            the built-in one, so a plain blog's screen is unchanged. */}
        {types.length > 1 && (
          <nav aria-label={t('Content type')} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.75rem' }}>
            {types.map(ct => (
              <button key={ct.key} type="button" onClick={() => changeType(ct.key)} aria-pressed={type === ct.key}
                className={`admin-btn ${type === ct.key ? 'admin-btn-primary' : 'admin-btn-secondary'}`}>
                {ct.plural_label}
              </button>
            ))}
          </nav>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <nav aria-label={t('Filter posts by status')} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
            {TABS.map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => changeFilter(tab)}
                className={`admin-btn ${filter === tab ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
                aria-pressed={filter === tab}
              >
                {tabLabels[tab]}{counts[tab] !== undefined ? ` (${counts[tab]})` : ''}
              </button>
            ))}
          </nav>

          <form onSubmit={submitSearch} role="search" style={{ display: 'flex', gap: '0.25rem' }}>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('Search posts')}
              className="admin-input"
              aria-label={t('Search posts')}
            />
            <button type="submit" className="admin-btn admin-btn-secondary">{t('Search')}</button>
          </form>
        </div>

        {selected.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span>{tn('{count} selected', '{count} selected', selected.length)}</span>
            {inTrash ? (
              <>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => runBulk('restore', selected)}>{t('Restore')}</button>
                <button type="button" className="admin-btn admin-btn-danger" onClick={() => runBulk('delete', selected)}>{t('Delete permanently')}</button>
              </>
            ) : (
              <>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => runBulk('publish', selected)}>{t('Publish')}</button>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => runBulk('draft', selected)}>{t('Unpublish')}</button>
                <button type="button" className="admin-btn admin-btn-danger" onClick={() => runBulk('trash', selected)}>{t('Move to trash')}</button>
              </>
            )}
          </div>
        )}

        {loading ? (
          <div className="admin-loading">{t('Loading...')}</div>
        ) : posts.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)', textAlign: 'center', padding: '2rem' }}>
            {query
              ? t('No posts match “{query}”.', { query })
              : inTrash
                ? t('The trash is empty.')
                : filter === 'all'
                  ? t('No posts yet. Create your first post!')
                  : t('Nothing here.')}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: '2rem' }}>
                  <input
                    type="checkbox"
                    aria-label={t('Select all posts on this page')}
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : posts.map(p => p.id))}
                  />
                </th>
                <th>{t('Title')}</th>
                <th>{t('Author')}</th>
                <th>{t('Categories')}</th>
                <th>{t('Status')}</th>
                <th>{t('Date')}</th>
                <th>{t('Actions')}</th>
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
                        aria-label={t('Select {name}', { name: post.title })}
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
                              {t('Restore')}
                            </button>
                            <button onClick={() => runBulk('delete', [post.id])} className="admin-btn admin-btn-danger">
                              {t('Delete permanently')}
                            </button>
                          </>
                        ) : (
                          <>
                            <Link href={`/admin/posts/${post.id}/edit`} className="admin-btn admin-btn-secondary">
                              {t('Edit')}
                            </Link>
                            <button onClick={() => trash(post.id)} className="admin-btn admin-btn-danger">
                              {t('Trash')}
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

        {meta && <Pagination meta={meta} onChange={setPage} noun={t('posts')} />}
      </div>
    </AdminLayout>
  )
}
