import React, { useState, useEffect } from 'react'
import { useNavigate } from '@basicbenframework/core/client'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface Post {
  id: number
  title: string
  published: boolean
  created_at: string
  category_name?: string
}

export default function AdminPosts() {
  const navigate = useNavigate()
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPosts()
  }, [])

  const loadPosts = async () => {
    try {
      const res = await api.get('/api/posts')
      setPosts(res?.posts || [])
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
      setPosts(posts.filter(p => p.id !== id))
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
          <a href="/admin/posts/new" className="admin-btn admin-btn-primary">
            + New Post
          </a>
        </div>

        {posts.length === 0 ? (
          <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem' }}>
            No posts yet. Create your first post!
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map(post => (
                <tr key={post.id}>
                  <td>
                    <a href={`/admin/posts/${post.id}/edit`} style={{ color: '#4f46e5', fontWeight: 500 }}>
                      {post.title}
                    </a>
                  </td>
                  <td>{post.category_name || '—'}</td>
                  <td>
                    <span className={`admin-badge ${post.published ? 'admin-badge-success' : 'admin-badge-warning'}`}>
                      {post.published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td>{new Date(post.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <a href={`/admin/posts/${post.id}/edit`} className="admin-btn admin-btn-secondary">
                        Edit
                      </a>
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
      </div>
    </AdminLayout>
  )
}
