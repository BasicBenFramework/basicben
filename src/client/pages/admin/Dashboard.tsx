import React, { useState, useEffect } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'
import type { Post, Page } from '../../../types'
import { Link } from '../../components/Link'
import { useT } from '../../i18n'

/**
 * A count the signed-in account is allowed to see, or `null` because it is not.
 *
 * Nothing here is optional to the person who can see all four; the nullability
 * is about permission, not about loading.
 */
interface Stats {
  posts: number | null
  pages: number | null
  pendingComments: number | null
  media: number | null
}

/** What a paginated listing returns beside its rows. */
interface Meta {
  total: number
}

/**
 * A request whose refusal is an answer rather than a failure.
 *
 * The four went out as one `Promise.all`, so a single 403 rejected the lot: an
 * author holds neither `page.edit` nor `comment.moderate`, and those two
 * refusals left the whole dashboard — the post count included — reading zero.
 */
const settle = <T,>(request: Promise<T>): Promise<T | null> =>
  request.catch(() => null)

export default function AdminDashboard() {
  const { t, locale } = useT()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentPosts, setRecentPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboardData()
  }, [])

  /**
   * The counts, and the five most recent posts.
   *
   * `/api/posts` and `/api/pages` are paginated, so the rows they return are
   * one page of rows. Counting that array reported the page size rather than
   * the total, and any site past its twentieth post sat at "20" for ever.
   * `meta.total` is the count the database did, which is what a stat card is
   * asking for.
   *
   * Five rows are shown, so five are asked for: this was fetching twenty posts
   * and twenty pages, bodies and all, to render two numbers and a short table.
   */
  const loadDashboardData = async () => {
    const [postsRes, pagesRes, commentsRes, mediaRes] = await Promise.all([
      settle(api.get<{ posts: Post[]; meta?: Meta }>('/api/posts?per_page=5')),
      settle(api.get<{ pages: Page[]; meta?: Meta }>('/api/pages?per_page=1')),
      settle(api.get<{ count: number }>('/api/comments/pending')),
      settle(api.get<{ stats: { total: number } }>('/api/media/stats'))
    ])

    setStats({
      posts: postsRes?.meta?.total ?? null,
      pages: pagesRes?.meta?.total ?? null,
      pendingComments: commentsRes?.count ?? null,
      media: mediaRes?.stats?.total ?? null
    })

    setRecentPosts(postsRes?.posts ?? [])
    setLoading(false)
  }

  /**
   * One card per stat that came back. A refused one is left out rather than
   * shown as zero — "0 Pending Comments" to somebody who may not moderate them
   * is a number the dashboard has no way to know.
   */
  const cards = [
    { label: t('Posts'), value: stats?.posts },
    { label: t('Pages'), value: stats?.pages },
    { label: t('Pending Comments'), value: stats?.pendingComments },
    { label: t('Media Files'), value: stats?.media }
  ].filter((card): card is { label: string; value: number } => typeof card.value === 'number')

  if (loading) {
    return (
      <AdminLayout title={t('Dashboard')}>
        <div className="admin-loading">{t('Loading...')}</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title={t('Dashboard')}>
      {/* Stats Grid. The column count follows the number of cards, so the two
          an author can see are not two cards and two empty quarters. */}
      {cards.length > 0 && (
        <div className={`admin-grid admin-grid-${Math.min(4, Math.max(2, cards.length))}`}>
          {cards.map(card => (
            <div key={card.label} className="admin-stat-card">
              <div className="admin-stat-value">{card.value}</div>
              <div className="admin-stat-label">{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Posts */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">{t('Recent Posts')}</h2>
          <Link href="/admin/posts/new" className="admin-btn admin-btn-primary">
            {t('New Post')}
          </Link>
        </div>

        {recentPosts.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)' }}>{t('No posts yet. Create your first post!')}</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('Title')}</th>
                <th>{t('Status')}</th>
                <th>{t('Date')}</th>
                <th>{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {recentPosts.map(post => (
                <tr key={post.id}>
                  <td>{post.title}</td>
                  <td>
                    <span className={`admin-badge ${post.published ? 'admin-badge-success' : 'admin-badge-warning'}`}>
                      {post.published ? t('Published') : t('Draft')}
                    </span>
                  </td>
                  <td>{new Date(post.created_at).toLocaleDateString(locale)}</td>
                  <td>
                    <Link href={`/admin/posts/${post.id}/edit`} className="admin-btn admin-btn-secondary">
                      {t('Edit')}
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
          <h3 className="admin-card-title">{t('Content')}</h3>
          <div className="admin-stack">
            <Link href="/admin/posts/new" className="admin-btn admin-btn-secondary">
              {t('New Post')}
            </Link>
            <Link href="/admin/pages/new" className="admin-btn admin-btn-secondary">
              {t('New Page')}
            </Link>
            <Link href="/admin/media" className="admin-btn admin-btn-secondary">
              {t('Upload Media')}
            </Link>
          </div>
        </div>

        <div className="admin-card">
          <h3 className="admin-card-title">{t('Extend')}</h3>
          <div className="admin-stack">
            <Link href="/admin/settings" className="admin-btn admin-btn-secondary">
              {t('Settings')}
            </Link>
          </div>
        </div>

        <div className="admin-card">
          <h3 className="admin-card-title">{t('Help')}</h3>
          <div className="admin-stack">
            <Link href="https://basicben.com/docs" target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn-secondary">
              {t('Documentation')}
            </Link>
            <Link href="/" className="admin-btn admin-btn-secondary">
              {t('View Site')}
            </Link>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
