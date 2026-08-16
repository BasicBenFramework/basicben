import React from 'react'
import type { Page } from '../../../src/types'

interface PageLayoutProps {
  page: Page
  siteName?: string
}

export default function PageLayout({
  page,
  siteName = 'My Blog'
}: PageLayoutProps) {
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
        <div className="theme-container theme-content">
          <article className="theme-page">
            <header className="theme-post-header">
              <h1 className="theme-post-title">{page.title}</h1>
            </header>

            {/*
              `content_html` is rendered from the Markdown in `content` and
              sanitized against an allowlist on the way — see
              @basicbenframework/core/content. That is what makes
              dangerouslySetInnerHTML correct here rather than merely
              convenient: the guarantee lives at the write boundary.

              Never point this at `content`. That is raw Markdown, and
              rendering it as HTML is the stored-XSS hole this replaced.
            */}
            {page.content_html && (
              <div
                className="theme-post-content"
                dangerouslySetInnerHTML={{ __html: page.content_html }}
              />
            )}
          </article>
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
