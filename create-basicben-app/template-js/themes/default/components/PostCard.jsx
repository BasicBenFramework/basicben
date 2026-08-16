import React from 'react'

export default function PostCard({ post, variant = 'default' }) {
  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  if (variant === 'compact') {
    return (
      <article className="theme-card" style={{ padding: 'var(--spacing-4)' }}>
        <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--spacing-2)' }}>
          <a href={`/blog/${post.slug || post.id}`}>{post.title}</a>
        </h3>
        <div className="theme-card-meta">
          <span>{formatDate(post.created_at)}</span>
        </div>
      </article>
    )
  }

  if (variant === 'featured') {
    return (
      <article className="theme-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-6)' }}>
        {post.featured_image_url && (
          <img
            src={post.featured_image_url}
            alt={post.title}
            style={{
              width: '100%',
              height: '300px',
              objectFit: 'cover',
              borderRadius: 'var(--layout-border-radius)'
            }}
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {post.category_name && (
            <span className="theme-tag" style={{ alignSelf: 'flex-start', marginBottom: 'var(--spacing-3)' }}>
              {post.category_name}
            </span>
          )}
          <h2 className="theme-card-title" style={{ fontSize: 'var(--text-2xl)' }}>
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
        </div>
      </article>
    )
  }

  // Default variant
  return (
    <article className="theme-card">
      {post.featured_image_url && (
        <img
          src={post.featured_image_url}
          alt={post.title}
          className="theme-card-image"
        />
      )}
      {post.category_name && (
        <span className="theme-tag" style={{ marginBottom: 'var(--spacing-3)', display: 'inline-block' }}>
          {post.category_name}
        </span>
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
