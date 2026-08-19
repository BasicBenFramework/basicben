import React, { useState, useEffect } from 'react'
import { useNavigate } from '@basicbenframework/core/client'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import { Link } from '../../components/Link'
import { Pagination, type PageMeta } from '../../components/admin/Pagination'

interface Post {
  id: number
  title: string
  published: boolean
  created_at: string
  /** Joined by the listing. An editor sees everyone's posts, so it matters. */
  author_name?: string
  categories?: Array<{ id: number; name: string; slug: string }>
}

export default function AdminPosts() {
  const navigate = useNavigate()
  const [posts, setPosts] = useState<Post[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPosts(page)
  }, [page])

  const loadPosts = async (which: number) => {
    setLoading(true)

    try {
      const res = await api.get<{ posts: Post[]; meta: PageMeta }>(`/api/posts?page=${which}`)
      setPosts(res?.posts || [])
      setMeta(res?.meta || null)
    } catch (error) {
      console.error('Failed to load posts:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this post?')) return

    try {
      await api.delete(`/api/posts/${id}`)

      // Reload rather than splice the row out. The page is a window on the
      // server's ordering, so removing a row locally leaves it one short and
      // silently hides whatever should have moved up into it. Stepping back a
      // page when the last row on it goes keeps the table from showing empty.
      const emptied = posts.length === 1 && page > 1

      if (emptied) setPage(page - 1)
      else loadPosts(page)
    } catch (error) {
      console.error('Failed to delete post:', error)
      alert('Failed to delete post')
    }
  }

  if (loading) {
    return (
      <AdminLayout title="Posts">
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Posts">
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">All Posts</h2>
          <Link href="/admin/posts/new" className="admin-btn admin-btn-primary">
            + New Post
          </Link>
        </div>

        {posts.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)', textAlign: 'center', padding: '2rem' }}>
            No posts yet. Create your first post!
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Author</th>
                <th>Categories</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map(post => (
                <tr key={post.id}>
                  <td>
                    <Link href={`/admin/posts/${post.id}/edit`} style={{ color: 'var(--accent)', fontWeight: 500 }}>
                      {post.title}
                    </Link>
                  </td>
                  <td>{post.author_name || '—'}</td>
                  <td>
                    {post.categories?.length
                      ? post.categories.map(c => c.name).join(', ')
                      : '—'}
                  </td>
                  <td>
                    <span className={`admin-badge ${post.published ? 'admin-badge-success' : 'admin-badge-warning'}`}>
                      {post.published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td>{new Date(post.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <Link href={`/admin/posts/${post.id}/edit`} className="admin-btn admin-btn-secondary">
                        Edit
                      </Link>
                      <button
                        onClick={() => handleDelete(post.id)}
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

        {meta && <Pagination meta={meta} onChange={setPage} noun="posts" />}
      </div>
    </AdminLayout>
  )
}
