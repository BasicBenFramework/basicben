import React from 'react'

export default function Sidebar({
  categories,
  tags,
  recentPosts,
  showSearch = true
}) {
  return (
    <aside className="theme-sidebar">
      {/* Search */}
      {showSearch && (
        <div className="theme-sidebar-section">
          <h3 className="theme-sidebar-title">Search</h3>
          <form action="/search" method="GET">
            <input
              type="search"
              name="q"
              placeholder="Search posts..."
              className="theme-input"
            />
          </form>
        </div>
      )}

      {/* Categories */}
      {categories && categories.length > 0 && (
        <div className="theme-sidebar-section">
          <h3 className="theme-sidebar-title">Categories</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {categories.map(cat => (
              <li key={cat.id} style={{ marginBottom: 'var(--spacing-2)' }}>
                <a
                  href={`/category/${cat.slug}`}
                  style={{ display: 'flex', justifyContent: 'space-between' }}
                >
                  <span>{cat.name}</span>
                  {cat.post_count !== undefined && (
                    <span className="theme-text-muted">{cat.post_count}</span>
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

      {/* Recent Posts */}
      {recentPosts && recentPosts.length > 0 && (
        <div className="theme-sidebar-section">
          <h3 className="theme-sidebar-title">Recent Posts</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {recentPosts.map(post => (
              <li key={post.id} style={{ marginBottom: 'var(--spacing-2)' }}>
                <a href={`/blog/${post.slug || post.id}`}>
                  {post.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
