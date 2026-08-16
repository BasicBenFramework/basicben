import React from 'react'
import type { Post, Category, Tag } from '../../../src/types'

interface ArchiveLayoutProps {
  title: string
  description?: string
  posts: Post[]
  categories?: Category[]
  tags?: Tag[]
  siteName?: string
  pagination?: {
    page: number
    totalPages: number
    baseUrl: string
  }
}

export default function ArchiveLayout({
  title,
  description,
  posts,
  categories,
  tags,
  siteName = 'My Blog',
  pagination
}: ArchiveLayoutProps) {
  return (
    <div className="theme-layout">
      {/* Header */}
      <header className="theme-header">
        <div className="theme-header-inner">
          <a href="/" className="theme-logo">
            {siteName}
          </a>
          <nav>
            <ul className="theme-nav">
              <li><a href="/">Home</a></li>
              <li><a href="/blog">Blog</a></li>
              <li><a href="/about">About</a></li>
            </ul>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="theme-main">
        <div className="theme-container">
          <div className="theme-grid theme-grid-sidebar">
            {/* Posts */}
            <div>
              <header className="theme-mb-8">
                <h1>{title}</h1>
                {description && <p className="theme-text-muted">{description}</p>}
              </header>

              {posts.length === 0 ? (
                <p className="theme-text-muted">No posts found.</p>
              ) : (
                <div className="theme-grid" style={{ gap: '2rem' }}>
                  {posts.map(post => (
                    <PostCard key={post.id} post={post} />
                  ))}
                </div>
              )}

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="theme-pagination">
                  {pagination.page > 1 && (
                    <a href={`${pagination.baseUrl}?page=${pagination.page - 1}`}>
                      Previous
                    </a>
                  )}
                  {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(page => (
                    <a
                      key={page}
                      href={`${pagination.baseUrl}?page=${page}`}
                      className={page === pagination.page ? 'active' : ''}
                    >
                      {page}
                    </a>
                  ))}
                  {pagination.page < pagination.totalPages && (
                    <a href={`${pagination.baseUrl}?page=${pagination.page + 1}`}>
                      Next
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Sidebar */}
            <aside className="theme-sidebar">
              {/* Categories */}
              {categories && categories.length > 0 && (
                <div className="theme-sidebar-section">
                  <h3 className="theme-sidebar-title">Categories</h3>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {categories.map(cat => (
                      <li key={cat.id} style={{ marginBottom: '0.5rem' }}>
                        <a href={`/category/${cat.slug}`}>
                          {cat.name}
                          {cat.post_count !== undefined && (
                            <span className="theme-text-muted"> ({cat.post_count})</span>
                          )}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tags */}
              {tags && tags.length > 0 && (
                <div className="theme-sidebar-section">
                  <h3 className="theme-sidebar-title">Tags</h3>
                  <div className="theme-tags">
                    {tags.map(tag => (
                      <a key={tag.id} href={`/tag/${tag.slug}`} className="theme-tag">
                        {tag.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="theme-footer">
        <div className="theme-container">
          <p>&copy; {new Date().getFullYear()} {siteName}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}

function PostCard({ post }: { post: Post }) {
  return (
    <article className="theme-card">
      {post.featured_image_url && (
        <img
          src={post.featured_image_url}
          alt={post.title}
          className="theme-card-image"
        />
      )}
      <h2 className="theme-card-title">
        <a href={`/blog/${post.slug || post.id}`}>{post.title}</a>
      </h2>
      {post.excerpt && (
        <p className="theme-card-excerpt">{post.excerpt}</p>
      )}
      <div className="theme-card-meta">
        {post.author_name && <span>By {post.author_name}</span>}
        {' · '}
        <span>{formatDate(post.created_at)}</span>
      </div>
    </article>
  )
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}
