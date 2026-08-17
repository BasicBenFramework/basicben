import React, { useEffect, useRef, useState } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import MediaGrid from '../../components/admin/MediaGrid'
import {
  MediaItem,
  isImage,
  mediaUrl,
  useMediaLibrary
} from '../../hooks/useMediaLibrary'

export default function AdminMedia() {
  const library = useMediaLibrary()

  const [selected, setSelected] = useState<MediaItem | null>(null)
  const [altDraft, setAltDraft] = useState('')
  const [savingAlt, setSavingAlt] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [bulk, setBulk] = useState<number[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // The selected file is a copy, so an alt-text save or a delete elsewhere has
  // to be reflected here rather than leaving a stale panel on screen.
  useEffect(() => {
    if (!selected) return
    const fresh = library.items.find(item => item.id === selected.id)
    if (!fresh) setSelected(null)
    else if (fresh !== selected) setSelected(fresh)
  }, [library.items, selected])

  const select = (item: MediaItem) => {
    setSelected(item)
    setAltDraft(item.alt_text || '')
  }

  const handleUpload = async (files: File[]) => {
    if (files.length === 0) return
    await library.upload(files)
  }

  const handleSaveAlt = async () => {
    if (!selected) return
    setSavingAlt(true)

    try {
      const updated = await library.saveAlt(selected.id, altDraft)
      setSelected(updated)
    } catch {
      alert('Failed to save the alt text')
    } finally {
      setSavingAlt(false)
    }
  }

  const handleDelete = async (ids: number[]) => {
    const many = ids.length > 1
    if (!confirm(many ? `Delete ${ids.length} files?` : 'Delete this file?')) return

    const removed = await library.remove(ids)
    if (removed.length < ids.length) alert('Some files could not be deleted.')

    setBulk(prev => prev.filter(id => !removed.includes(id)))
  }

  const toggleBulk = (id: number) => {
    setBulk(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <AdminLayout title="Media Library">
      <div
        onDragOver={event => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault()
          setDragging(false)
          void handleUpload(Array.from(event.dataTransfer.files))
        }}
        className="admin-grid admin-grid-2"
        style={{
          gridTemplateColumns: '2fr 1fr',
          outline: dragging ? '2px dashed #4f46e5' : 'none',
          outlineOffset: '0.5rem'
        }}
      >
        <div className="admin-card">
          <div className="admin-card-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 className="admin-card-title" style={{ marginRight: 'auto' }}>
              All Media{library.total > 0 && <span style={{ color: '#6b7280' }}> ({library.total})</span>}
            </h2>

            <input
              type="search"
              value={library.search}
              onChange={event => library.setSearch(event.target.value)}
              placeholder="Search files"
              className="admin-input"
              style={{ maxWidth: '180px' }}
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

            <button
              onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
              className="admin-btn admin-btn-secondary"
              title={view === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
            >
              {view === 'grid' ? '☰' : '▦'}
            </button>

            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
              style={{ display: 'none' }}
              onChange={event => {
                void handleUpload(Array.from(event.target.files || []))
                event.target.value = ''
              }}
            />
            <button onClick={() => fileInput.current?.click()} className="admin-btn admin-btn-primary">
              + Upload Files
            </button>
          </div>

          {library.uploads.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              {library.uploads.map(upload => (
                <div key={upload.name} style={{ fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{upload.name}</span>
                    <span style={{ color: upload.error ? '#b91c1c' : '#6b7280' }}>
                      {upload.error || (upload.percent === null ? 'starting…' : `${upload.percent}%`)}
                    </span>
                  </div>
                  {!upload.error && (
                    <div style={{ height: '3px', background: '#e5e7eb', borderRadius: '2px' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${upload.percent ?? 0}%`,
                          background: '#4f46e5',
                          borderRadius: '2px',
                          transition: 'width 0.2s'
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
              {library.uploads.some(u => u.error) && (
                <button className="admin-btn admin-btn-secondary" onClick={library.dismissUploads}>
                  Dismiss
                </button>
              )}
            </div>
          )}

          {bulk.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                marginBottom: '1rem'
              }}
            >
              <span style={{ fontSize: '0.85rem' }}>{bulk.length} selected</span>
              <button className="admin-btn admin-btn-danger" onClick={() => handleDelete(bulk)}>
                Delete selected
              </button>
              <button className="admin-btn admin-btn-secondary" onClick={() => setBulk([])}>
                Clear
              </button>
            </div>
          )}

          {library.loading ? (
            <div className="admin-loading">Loading...</div>
          ) : (
            <MediaGrid
              items={library.items}
              selectedIds={selected ? [selected.id] : []}
              onSelect={select}
              onLoadMore={library.loadMore}
              hasMore={library.hasMore}
              loadingMore={library.loadingMore}
              view={view}
              renderBadge={item => (
                <input
                  type="checkbox"
                  checked={bulk.includes(item.id)}
                  onChange={() => toggleBulk(item.id)}
                  aria-label={`Select ${item.original_name}`}
                />
              )}
              emptyMessage={
                library.search || library.type
                  ? 'Nothing matches that.'
                  : 'No media files yet — upload or drop files here.'
              }
            />
          )}
        </div>

        <div className="admin-card">
          <h3 className="admin-card-title">Details</h3>

          {selected ? (
            <div>
              {isImage(selected.mime_type) && (
                <img
                  src={mediaUrl(selected)}
                  alt={selected.alt_text || selected.original_name}
                  style={{ width: '100%', borderRadius: '0.375rem', marginBottom: '1rem' }}
                />
              )}

              <div style={{ marginBottom: '1rem' }}>
                <p><strong>Filename:</strong> {selected.original_name}</p>
                <p><strong>Type:</strong> {selected.mime_type || 'Unknown'}</p>
                <p><strong>Size:</strong> {formatFileSize(selected.size)}</p>
                <p><strong>Uploaded:</strong> {new Date(selected.created_at).toLocaleDateString()}</p>
              </div>

              <div className="admin-form-group">
                <label className="admin-label" htmlFor="media-alt">Alt text</label>
                <input
                  id="media-alt"
                  type="text"
                  value={altDraft}
                  onChange={event => setAltDraft(event.target.value)}
                  className="admin-input"
                  placeholder="Describe the image for screen readers"
                />
                <button
                  onClick={handleSaveAlt}
                  className="admin-btn admin-btn-secondary"
                  disabled={savingAlt || altDraft === (selected.alt_text || '')}
                  style={{ marginTop: '0.5rem' }}
                >
                  {savingAlt ? 'Saving...' : 'Save alt text'}
                </button>
              </div>

              <div className="admin-form-group">
                <label className="admin-label">URL</label>
                <input
                  type="text"
                  value={mediaUrl(selected)}
                  readOnly
                  className="admin-input"
                  onClick={event => (event.target as HTMLInputElement).select()}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => navigator.clipboard.writeText(mediaUrl(selected))}
                  className="admin-btn admin-btn-secondary"
                >
                  Copy URL
                </button>
                <button
                  onClick={() => handleDelete([selected.id])}
                  className="admin-btn admin-btn-danger"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <p style={{ color: '#6b7280' }}>Select a file to view details</p>
          )}
        </div>
      </div>
    </AdminLayout>
  )
}
