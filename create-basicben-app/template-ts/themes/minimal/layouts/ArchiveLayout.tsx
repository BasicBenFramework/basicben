import React from 'react'
import { Header, Footer } from '../components/Chrome'
import type { Post } from '../../../src/types'

/**
 * A list of posts as a plain index: title, date, excerpt. No cards, no images,
 * no sidebar.
 *
 * The props are the same shape the default theme's ArchiveLayout declares,
 * because the page passes one set of props and any theme has to accept them.
 * A theme is free to ignore what it does not use — this one ignores
 * `categories`, `tags` and `pagination`.
 */

interface ArchiveLayoutProps {
  title: string
  description?: string
  posts: Post[]
  siteName?: string
}

export default function ArchiveLayout({
  title,
  description,
  posts,
  siteName = 'My Blog'
}: ArchiveLayoutProps) {
  return (
    <div className="theme-layout theme-minimal">
      <Header siteName={siteName} />

      <main className="theme-main">
        <h1 className="theme-page-title">{title}</h1>
        {description && <p className="theme-page-description">{description}</p>}

        {posts.length === 0 ? (
          <p className="theme-empty">Nothing here yet.</p>
        ) : (
          <ul className="theme-index">
            {posts.map(post => (
              <li key={post.id} className="theme-index-item">
                <a href={`/feed/${post.id}`} className="theme-index-link">
                  <span className="theme-index-title">{post.title}</span>
                  <time className="theme-index-date" dateTime={post.created_at}>
                    {formatDate(post.created_at)}
                  </time>
                </a>
                {post.excerpt && <p className="theme-index-excerpt">{post.excerpt}</p>}
              </li>
            ))}
          </ul>
        )}
      </main>

      <Footer siteName={siteName} />
    </div>
  )
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}
