import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import type { Post, Page } from '../../../types'
import { Link } from '../../components/Link'

interface Stats {
  posts: number
  pages: number
  comments: number
  pendingComments: number
  media: number
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentPosts, setRecentPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    try {
      const [postsRes, pagesRes, commentsRes, mediaRes] = await Promise.all([
        api.get<{ posts: Post[] }>('/api/posts'),
        api.get<{ pages: Page[] }>('/api/pages'),
        api.get<{ count: number }>('/api/comments/pending'),
        api.get<{ stats: { total: number } }>('/api/media/stats')
      ])

      setStats({
        posts: postsRes?.posts?.length || 0,
        pages: pagesRes?.pages?.length || 0,
        comments: 0,
        pendingComments: commentsRes?.count || 0,
        media: mediaRes?.stats?.total || 0
      })

      setRecentPosts((postsRes?.posts || []).slice(0, 5))
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <AdminLayout title="Dashboard">
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Dashboard">
      {/* Stats Grid */}
      <div className="admin-grid admin-grid-4">
        <div className="admin-stat-card">
          <div className="admin-stat-value">{stats?.posts || 0}</div>
          <div className="admin-stat-label">Posts</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{stats?.pages || 0}</div>
          <div className="admin-stat-label">Pages</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{stats?.pendingComments || 0}</div>
          <div className="admin-stat-label">Pending Comments</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{stats?.media || 0}</div>
          <div className="admin-stat-label">Media Files</div>
        </div>
      </div>

      {/* Recent Posts */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Recent Posts</h2>
          <Link href="/admin/posts/new" className="admin-btn admin-btn-primary">
            New Post
          </Link>
        </div>

        {recentPosts.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)' }}>No posts yet. Create your first post!</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recentPosts.map(post => (
                <tr key={post.id}>
                  <td>{post.title}</td>
                  <td>
                    <span className={`admin-badge ${post.published ? 'admin-badge-success' : 'admin-badge-warning'}`}>
                      {post.published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td>{new Date(post.created_at).toLocaleDateString()}</td>
                  <td>
                    <Link href={`/admin/posts/${post.id}/edit`} className="admin-btn admin-btn-secondary">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick Actions */}
      <div className="admin-grid admin-grid-3">
        <div className="admin-card">
          <h3 className="admin-card-title">Content</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            <Link href="/admin/posts/new" className="admin-btn admin-btn-secondary">
              New Post
            </Link>
            <Link href="/admin/pages/new" className="admin-btn admin-btn-secondary">
              New Page
            </Link>
            <Link href="/admin/media" className="admin-btn admin-btn-secondary">
              Upload Media
            </Link>
          </div>
        </div>

        <div className="admin-card">
          <h3 className="admin-card-title">Extend</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            <Link href="/admin/settings" className="admin-btn admin-btn-secondary">
              Settings
            </Link>
          </div>
        </div>

        <div className="admin-card">
          <h3 className="admin-card-title">Help</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            <Link href="https://basicben.com/docs" target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn-secondary">
              Documentation
            </Link>
            <Link href="/" className="admin-btn admin-btn-secondary">
              View Site
            </Link>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
