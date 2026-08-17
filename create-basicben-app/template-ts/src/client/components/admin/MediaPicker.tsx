import React, { useRef, useState } from 'react'
import { MediaItem, isImage, mediaUrl, useMediaLibrary } from '../../hooks/useMediaLibrary'
import MediaGrid from './MediaGrid'

/**
 * Choose a file, or upload one, without leaving the editor.
 *
 * Before this the library was a filing cabinet: you uploaded on one screen,
 * copied a URL, then came back and typed the Markdown by hand. Putting a file
 * into a post is the reason the library exists, so it belongs here.
 */

interface MediaPickerProps {
  onSelect: (item: MediaItem) => void
  onClose: () => void
}

export default function MediaPicker({ onSelect, onClose }: MediaPickerProps) {
  const library = useMediaLibrary()
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const uploadAndSelect = async (files: File[]) => {
    const uploaded = await library.upload(files)
    // Choosing the first of a batch is the common case: you dropped the image
    // you wanted in order to use it.
    if (uploaded[0]) onSelect(uploaded[0])
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Media library"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '1rem'
      }}
    >
      <div
        onClick={event => event.stopPropagation()}
        onDragOver={event => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault()
          setDragging(false)
          void uploadAndSelect(Array.from(event.dataTransfer.files))
        }}
        style={{
          background: 'var(--surface)',
          borderRadius: '0.5rem',
          width: 'min(880px, 100%)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          outline: dragging ? '2px dashed var(--accent)' : 'none'
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            padding: '1rem',
            borderBottom: '1px solid var(--border)'
          }}
        >
          <strong style={{ marginRight: 'auto' }}>Media library</strong>

          <input
            type="search"
            value={library.search}
            onChange={event => library.setSearch(event.target.value)}
            placeholder="Search files"
            className="admin-input"
            style={{ maxWidth: '200px' }}
          />

          <select
            value={library.type}
            onChange={event => library.setType(event.target.value)}
            className="admin-input"
            style={{ maxWidth: '140px' }}
          >
            <option value="">All types</option>
            <option value="image">Images</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="other">Documents</option>
          </select>

          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
            style={{ display: 'none' }}
            onChange={event => {
              void uploadAndSelect(Array.from(event.target.files || []))
              event.target.value = ''
            }}
          />
          <button className="admin-btn admin-btn-primary" onClick={() => fileInput.current?.click()}>
            Upload
          </button>
          <button className="admin-btn admin-btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {library.uploads.length > 0 && (
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
            {library.uploads.map(upload => (
              <div key={upload.name} style={{ fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                {upload.name}{' '}
                {upload.error ? (
                  <span style={{ color: 'var(--danger)' }}>{upload.error}</span>
                ) : (
                  <span style={{ color: 'var(--fg-muted)' }}>
                    {upload.percent === null ? 'starting…' : `${upload.percent}%`}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ overflowY: 'auto', padding: '1rem' }}>
          {library.loading ? (
            <p style={{ color: 'var(--fg-muted)', textAlign: 'center' }}>Loading…</p>
          ) : (
            <MediaGrid
              items={library.items}
              selectedIds={[]}
              onSelect={onSelect}
              onLoadMore={library.loadMore}
              hasMore={library.hasMore}
              loadingMore={library.loadingMore}
              emptyMessage={
                library.search || library.type
                  ? 'Nothing matches that.'
                  : 'No media yet — upload or drop a file here.'
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** The Markdown for a chosen file: an image embed, or a link to anything else. */
export function markdownFor(item: MediaItem) {
  const url = mediaUrl(item)

  return isImage(item.mime_type)
    ? `![${item.alt_text || item.original_name}](${url})`
    : `[${item.original_name}](${url})`
}
