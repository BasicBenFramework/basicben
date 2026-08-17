import React, { useEffect, useRef } from 'react'
import { MediaItem, isImage, mediaUrl } from '../../hooks/useMediaLibrary'

/**
 * A scrollable grid of media that fetches the next page as it nears the bottom.
 *
 * The library is paginated, so a grid that only ever rendered what it was first
 * given would silently stop at the first page — which is what the admin page
 * did: twenty files, and no way to reach the twenty-first.
 */

interface MediaGridProps {
  items: MediaItem[]
  selectedIds: number[]
  onSelect: (item: MediaItem) => void
  onLoadMore: () => void
  hasMore: boolean
  loadingMore: boolean
  view?: 'grid' | 'list'
  /** Rendered top-right of each tile; used for the bulk-select checkbox. */
  renderBadge?: (item: MediaItem) => React.ReactNode
  emptyMessage?: string
}

export default function MediaGrid({
  items,
  selectedIds,
  onSelect,
  onLoadMore,
  hasMore,
  loadingMore,
  view = 'grid',
  renderBadge,
  emptyMessage = 'No media files yet. Upload some!'
}: MediaGridProps) {
  const sentinel = useRef<HTMLDivElement>(null)

  // A sentinel below the last row rather than a scroll listener: the observer
  // fires only when the element is actually reachable, so it works the same
  // whether the grid scrolls itself or the page does.
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) onLoadMore()
      },
      { rootMargin: '200px' }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore, items.length])

  if (items.length === 0) {
    return (
      <p style={{ color: 'var(--fg-muted)', textAlign: 'center', padding: '2rem' }}>{emptyMessage}</p>
    )
  }

  return (
    <>
      <div
        style={
          view === 'list'
            ? { display: 'flex', flexDirection: 'column', gap: '0.25rem' }
            : {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: '1rem'
              }
        }
      >
        {items.map(item => {
          const selected = selectedIds.includes(item.id)

          return (
            <div
              key={item.id}
              onClick={() => onSelect(item)}
              style={{
                position: 'relative',
                cursor: 'pointer',
                border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: '0.375rem',
                overflow: 'hidden',
                backgroundColor: 'var(--surface-hover)',
                display: view === 'list' ? 'flex' : 'block',
                alignItems: 'center',
                gap: view === 'list' ? '0.75rem' : undefined
              }}
            >
              {renderBadge && (
                <div
                  style={{ position: 'absolute', top: '0.25rem', left: '0.25rem', zIndex: 1 }}
                  onClick={event => event.stopPropagation()}
                >
                  {renderBadge(item)}
                </div>
              )}

              {isImage(item.mime_type) ? (
                <img
                  src={mediaUrl(item)}
                  alt={item.alt_text || item.original_name}
                  // Nothing generates thumbnails, so every tile is the full
                  // original. Deferring off-screen ones is what keeps a library
                  // of large photographs from loading all of them at once.
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: view === 'list' ? '48px' : '100%',
                    height: view === 'list' ? '48px' : '120px',
                    objectFit: 'cover',
                    flexShrink: 0
                  }}
                />
              ) : (
                <div
                  style={{
                    width: view === 'list' ? '48px' : '100%',
                    height: view === 'list' ? '48px' : '120px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: view === 'list' ? '1.25rem' : '2rem',
                    flexShrink: 0
                  }}
                >
                  📄
                </div>
              )}

              <div
                style={{
                  padding: view === 'list' ? '0' : '0.5rem',
                  fontSize: '0.75rem',
                  color: 'var(--fg-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={item.original_name}
              >
                {item.original_name}
              </div>
            </div>
          )
        })}
      </div>

      <div ref={sentinel} style={{ height: '1px' }} />

      {loadingMore && (
        <p style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: '1rem' }}>Loading more…</p>
      )}
    </>
  )
}
