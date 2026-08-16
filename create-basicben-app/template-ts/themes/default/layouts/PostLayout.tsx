import React from 'react'
import Header from '../components/Header'
import Footer from '../components/Footer'
import type { Post } from '../../../src/types'

/**
 * A single post: title, meta, body, tags, author, then whatever the page hangs
 * underneath — comments, usually.
 *
 * Chrome comes from `../components/`; only the parts specific to one post live
 * here.
 */

interface PostLayoutProps {
  post: Post
  siteName?: string
  navigation?: Array<{ label: string; href: string }>
  children?: React.ReactNode
}

export default function PostLayout({
  post,
  siteName = 'My Blog',
  navigation,
  children
}: PostLayoutProps) {
  return (
    <div className="theme-layout">
      <Header siteName={siteName} navigation={navigation} />

      <main className="theme-main">
        <article className="theme-post">
          <header className="theme-post-header">
            <h1 className="theme-post-title">{post.title}</h1>
            <div className="theme-post-meta">
              {post.author_name && <span>By {post.author_name}</span>}
              <time dateTime={post.created_at}>{formatDate(post.created_at)}</time>
              {post.category_name && <span>in {post.category_name}</span>}
            </div>
          </header>

          {post.featured_image_url && (
            <img
              src={post.featured_image_url}
              alt={post.title}
              className="theme-post-featured-image"
            />
          )}

          {/*
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

          {post.tags && post.tags.length > 0 && (
            <div className="theme-tags theme-mt-8">
              {post.tags.map(tag => (
                <a key={tag.id} href={`/tag/${tag.slug}`} className="theme-tag">
                  {tag.name}
                </a>
              ))}
            </div>
          )}

          {post.author_name && (
            <div className="theme-author-bio">
              <img
                src={`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(post.author_name)}`}
                alt={post.author_name}
                className="theme-author-avatar"
              />
              <div>
                <div className="theme-author-name">{post.author_name}</div>
                <p className="theme-author-description">Author at {siteName}</p>
              </div>
            </div>
          )}

          {/* Comments and anything else the page appends. */}
          {children}
        </article>
      </main>

      <Footer siteName={siteName} navigation={navigation} />
    </div>
  )
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}
