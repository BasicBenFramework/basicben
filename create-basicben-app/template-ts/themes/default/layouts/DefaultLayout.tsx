import React from 'react'
import Header from '../components/Header'
import Footer from '../components/Footer'

/**
 * The generic page frame: site chrome around whatever you give it.
 *
 * The header and footer are composed from `../components/` rather than written
 * out here, and the same is true of the other three layouts. That is the point
 * of having both directories — layouts differ because they take different
 * *data* (one post, many posts, a page), not because they need different
 * chrome. Restating the nav in each one means changing the nav is a four-file
 * edit with one of them forgotten.
 */

interface DefaultLayoutProps {
  children: React.ReactNode
  siteName?: string
  siteDescription?: string
  navigation?: Array<{ label: string; href: string }>
}

export default function DefaultLayout({
  children,
  siteName = 'My Blog',
  siteDescription = '',
  navigation
}: DefaultLayoutProps) {
  return (
    <div className="theme-layout">
      <Header siteName={siteName} navigation={navigation} />

      <main className="theme-main">
        <div className="theme-container">
          {children}
        </div>
      </main>

      <Footer siteName={siteName} siteDescription={siteDescription} navigation={navigation} />
    </div>
  )
}
