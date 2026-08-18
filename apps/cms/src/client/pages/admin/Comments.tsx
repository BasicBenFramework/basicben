import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface Comment {
  id: number
  content: string
  author_name?: string
  user_name?: string
  post_title?: string
  approved: boolean
  created_at: string
}

export default function AdminComments() {
  const [comments, setComments] = useState<Comment[]>([])
  const [filter, setFilter] = useState<'all' | 'pending'>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadComments()
  }, [filter])

  const loadComments = async () => {
    setLoading(true)
    try {
      const endpoint = filter === 'pending' ? '/api/comments/pending' : '/api/comments'
      const res = await api.get<{ comments: Comment[] }>(endpoint)
      setComments(res?.comments || [])
    } catch (error) {
      console.error('Failed to load comments:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (id: number) => {
    try {
      await api.put(`/api/comments/${id}/approve`)
      setComments(comments.map(c =>
        c.id === id ? { ...c, approved: true } : c
      ))
    } catch (error) {
      alert('Failed to approve comment')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this comment?')) return

    try {
      await api.delete(`/api/comments/${id}`)
      setComments(comments.filter(c => c.id !== id))
    } catch (error) {
      alert('Failed to delete comment')
    }
  }

  if (loading) {
    return (
      <AdminLayout title="Comments">
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Comments">
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">Comments</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setFilter('all')}
              className={`admin-btn ${filter === 'all' ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('pending')}
              className={`admin-btn ${filter === 'pending' ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
            >
              Pending
            </button>
          </div>
        </div>

        {comments.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)', textAlign: 'center', padding: '2rem' }}>
            No {filter === 'pending' ? 'pending ' : ''}comments.
          </p>
        ) : (
          <div>
            {comments.map(comment => (
              <div
                key={comment.id}
                style={{
                  padding: '1rem',
                  borderBottom: '1px solid var(--border)',
                  backgroundColor: comment.approved ? 'var(--surface)' : 'var(--tint-warning)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div>
                    <strong>{comment.user_name || comment.author_name || 'Anonymous'}</strong>
                    {comment.post_title && (
                      <span style={{ color: 'var(--fg-muted)' }}> on {comment.post_title}</span>
                    )}
                  </div>
                  <span style={{ color: 'var(--fg-muted)', fontSize: '0.875rem' }}>
                    {new Date(comment.created_at).toLocaleDateString()}
                  </span>
                </div>

                <p style={{ margin: '0.5rem 0', color: 'var(--fg)' }}>{comment.content}</p>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {!comment.approved && (
                    <span className="admin-badge admin-badge-warning">Pending</span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                    {!comment.approved && (
                      <button
                        onClick={() => handleApprove(comment.id)}
                        className="admin-btn admin-btn-primary"
                      >
                        Approve
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(comment.id)}
                      className="admin-btn admin-btn-danger"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
