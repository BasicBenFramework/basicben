import React from 'react'
import Header from '../components/Header'
import Footer from '../components/Footer'
import Sidebar from '../components/Sidebar'
import PostCard from '../components/PostCard'

/**
 * A list of posts — the shape behind an index, a category, a tag or a search.
 *
 * Everything visual here is composed from `../components/`. This layout used to
 * carry its own copy of the header, the footer, the sidebar and a cut-down
 * PostCard, all of which already existed as components and none of which were
 * imported. The inline PostCard had drifted: it had lost the category badge and
 * the compact and featured variants.
 */

export default function ArchiveLayout({
  title,
  description,
  posts,
  categories,
  tags,
  siteName = 'My Blog',
  navigation,
  pagination
}) {
  // Only render the sidebar column when there is something to put in it.
  const hasSidebar = Boolean(categories?.length || tags?.length)

  return (
    <div className="theme-layout">
      <Header siteName={siteName} navigation={navigation} />

      <main className="theme-main">
        <div className="theme-container">
          <div className={hasSidebar ? 'theme-grid theme-grid-sidebar' : ''}>
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

              {pagination && pagination.totalPages > 1 && (
                <Pagination {...pagination} />
              )}
            </div>

            {hasSidebar && (
              <Sidebar categories={categories} tags={tags} showSearch={false} />
            )}
          </div>
        </div>
      </main>

      <Footer siteName={siteName} navigation={navigation} />
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  baseUrl
}) {
  return (
    <div className="theme-pagination">
      {page > 1 && <a href={`${baseUrl}?page=${page - 1}`}>Previous</a>}

      {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
        <a
          key={n}
          href={`${baseUrl}?page=${n}`}
          className={n === page ? 'active' : ''}
          aria-current={n === page ? 'page' : undefined}
        >
          {n}
        </a>
      ))}

      {page < totalPages && <a href={`${baseUrl}?page=${page + 1}`}>Next</a>}
    </div>
  )
}
