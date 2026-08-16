import React from 'react'
import type { Post } from '../../../../src/types'

interface PostLayoutProps {
  post: Post
  siteName?: string
  children?: React.ReactNode
}

export default function PostLayout({
  post,
  siteName = 'My Blog',
  children
}: PostLayoutProps) {
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
        <article className="theme-post">
          {/* Post Header */}
          <header className="theme-post-header">
            <h1 className="theme-post-title">{post.title}</h1>
            <div className="theme-post-meta">
              {post.author_name && <span>By {post.author_name}</span>}
              <span>{formatDate(post.created_at)}</span>
              {post.category_name && <span>in {post.category_name}</span>}
            </div>
          </header>

          {/* Featured Image */}
          {post.featured_image_url && (
            <img
              src={post.featured_image_url}
              alt={post.title}
              className="theme-post-featured-image"
            />
          )}

          {/*
            Post Content

            `content_html` is rendered from the Markdown in `content` and
            sanitized against an allowlist on the way — see
            @basicbenframework/core/content. That is what makes
            dangerouslySetInnerHTML correct here rather than merely convenient:
            the guarantee lives at the write boundary, not at this line.

            Never point this at `content`. That is raw Markdown, and rendering
            it as HTML is exactly the stored-XSS hole this replaced.
          */}
          <div
            className="theme-post-content"
            dangerouslySetInnerHTML={{ __html: post.content_html || '' }}
          />

          {/* Tags */}
          {post.tags && post.tags.length > 0 && (
            <div className="theme-tags theme-mt-8">
              {post.tags.map(tag => (
                <a key={tag.id} href={`/tag/${tag.slug}`} className="theme-tag">
                  {tag.name}
                </a>
              ))}
            </div>
          )}

          {/* Author Bio */}
          {post.author_name && (
            <div className="theme-author-bio">
              <img
                src={`https://api.dicebear.com/7.x/initials/svg?seed=${post.author_name}`}
                alt={post.author_name}
                className="theme-author-avatar"
              />
              <div>
                <div className="theme-author-name">{post.author_name}</div>
                <p className="theme-author-description">
                  Author at {siteName}
                </p>
              </div>
            </div>
          )}

          {/* Additional content (comments, etc) */}
          {children}
        </article>
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

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}
