import React from 'react'
import Header from '../components/Header'
import Footer from '../components/Footer'
import type { Page } from '../../../src/types'

/**
 * A static page. Same chrome as everything else, no post metadata.
 */

interface PageLayoutProps {
  page: Page
  siteName?: string
  navigation?: Array<{ label: string; href: string }>
  children?: React.ReactNode
}

export default function PageLayout({
  page,
  siteName = 'My Blog',
  navigation,
  children
}: PageLayoutProps) {
  return (
    <div className="theme-layout">
      <Header siteName={siteName} navigation={navigation} />

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

            {children}
          </article>
        </div>
      </main>

      <Footer siteName={siteName} navigation={navigation} />
    </div>
  )
}
