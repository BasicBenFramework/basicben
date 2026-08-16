import React from 'react'
import { Header, Footer } from '../components/Chrome'
import type { Post } from '../../../src/types'

/**
 * A single post, stripped back.
 *
 * No sidebar, no author bio, no related posts — one column of text at a
 * readable measure. It reuses the `theme-*` class names so the shared stylesheet
 * still applies; `styles/main.css` only changes what it needs to.
 */

interface PostLayoutProps {
  post: Post
  siteName?: string
  children?: React.ReactNode
}

export default function PostLayout({ post, siteName = 'My Blog', children }: PostLayoutProps) {
  return (
    <div className="theme-layout theme-minimal">
      <Header siteName={siteName} />

      <main className="theme-main">
        <article className="theme-post">
          <header className="theme-post-header">
            <h1 className="theme-post-title">{post.title}</h1>
            <div className="theme-post-meta">
              <time dateTime={post.created_at}>{formatDate(post.created_at)}</time>
              {post.author_name && <span> · {post.author_name}</span>}
            </div>
          </header>

          {/*
            content_html is rendered from the Markdown in `content` and sanitized
            against an allowlist on the way — see
            @basicbenframework/core/content. Never point this at `content`: that
            is raw Markdown, and rendering it as HTML is stored XSS.
          */}
          <div
            className="theme-post-content"
            dangerouslySetInnerHTML={{ __html: post.content_html || '' }}
          />

          {post.tags && post.tags.length > 0 && (
            <div className="theme-tags">
              {post.tags.map(tag => (
                <a key={tag.id} href={`/tag/${tag.slug}`} className="theme-tag">{tag.name}</a>
              ))}
            </div>
          )}

          {children}
        </article>
      </main>

      <Footer siteName={siteName} />
    </div>
  )
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}
