import React, { useState, useEffect, useRef } from 'react'
import { api } from '../../../helpers/api'
import AdminLayout from '../../layouts/AdminLayout'

interface MediaItem {
  id: number
  filename: string
  original_name: string
  /** The storage key. Not a URL — see `url`. */
  path: string
  /**
   * Where the file is actually served from.
   *
   * The database stores a key rather than a URL so that moving buckets, or
   * putting a CDN in front of one, does not mean rewriting every row. The
   * server resolves it per request.
   */
  url?: string
  mime_type?: string
  size?: number
  alt_text?: string
  created_at: string
}

export default function AdminMedia() {
  const [media, setMedia] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadMedia()
  }, [])

  const loadMedia = async () => {
    try {
      const res = await api.get('/api/media')
      setMedia(res?.media || [])
    } catch (error) {
      console.error('Failed to load media:', error)
    } finally {
      setLoading(false)
    }
  }

  /**
   * Upload in three steps: ask the server to sign a URL, PUT the file straight
   * to storage, then tell the server it landed.
   *
   * The bytes go to the bucket, not through the API, which is why there is no
   * FormData here and no size limit imposed by the server's body parser.
   */
  const uploadOne = async (file: File) => {
    const signed = await api.post('/api/media/sign', {
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size
    })

    if (!signed?.uploadUrl) {
      throw new Error(signed?.error || 'Could not start the upload.')
    }

    // The signature covers the content type, so it has to be sent exactly as
    // it was signed — anything else and storage refuses the request.
    const put = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: signed.headers,
      body: file
    })

    if (!put.ok) {
      throw new Error(`Storage refused the upload (${put.status}).`)
    }

    const confirmed = await api.post('/api/media/confirm', {
      key: signed.key,
      ticket: signed.ticket,
      filename: file.name
    })

    if (!confirmed?.media) {
      throw new Error(confirmed?.error || 'The upload could not be confirmed.')
    }

    return confirmed.media
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploading(true)

    const uploaded: MediaItem[] = []
    const failures: string[] = []

    // One at a time, and one failure does not discard the rest — a rejected
    // file should not lose the four that worked.
    for (const file of Array.from(files)) {
      try {
        uploaded.push(await uploadOne(file))
      } catch (error) {
        failures.push(`${file.name}: ${(error as Error).message}`)
      }
    }

    if (uploaded.length > 0) setMedia([...uploaded, ...media])
    if (failures.length > 0) alert(`Some files were not uploaded:\n\n${failures.join('\n')}`)

    setUploading(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this file?')) return

    try {
      await api.delete(`/api/media/${id}`)
      setMedia(media.filter(m => m.id !== id))
      if (selectedMedia?.id === id) {
        setSelectedMedia(null)
      }
    } catch (error) {
      alert('Failed to delete file')
    }
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const isImage = (mimeType?: string) => {
    return mimeType?.startsWith('image/')
  }

  if (loading) {
    return (
      <AdminLayout title="Media">
        <div className="admin-loading">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Media Library">
      <div className="admin-grid admin-grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
        {/* Media Grid */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">All Media</h2>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleUpload}
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                style={{ display: 'none' }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="admin-btn admin-btn-primary"
                disabled={uploading}
              >
                {uploading ? 'Uploading...' : '+ Upload Files'}
              </button>
            </div>
          </div>

          {media.length === 0 ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem' }}>
              No media files yet. Upload some!
            </p>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: '1rem'
            }}>
              {media.map(item => (
                <div
                  key={item.id}
                  onClick={() => setSelectedMedia(item)}
                  style={{
                    cursor: 'pointer',
                    border: selectedMedia?.id === item.id ? '2px solid #4f46e5' : '1px solid #e5e7eb',
                    borderRadius: '0.375rem',
                    overflow: 'hidden',
                    backgroundColor: '#f9fafb'
                  }}
                >
                  {isImage(item.mime_type) ? (
                    <img
                      src={item.url || item.path}
                      alt={item.alt_text || item.original_name}
                      style={{
                        width: '100%',
                        height: '120px',
                        objectFit: 'cover'
                      }}
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      height: '120px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '2rem'
                    }}>
                      📄
                    </div>
                  )}
                  <div style={{ padding: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
                    {item.original_name.length > 20
                      ? item.original_name.slice(0, 20) + '...'
                      : item.original_name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Media Details */}
        <div className="admin-card">
          <h3 className="admin-card-title">Details</h3>

          {selectedMedia ? (
            <div>
              {isImage(selectedMedia.mime_type) && (
                <img
                  src={selectedMedia.url || selectedMedia.path}
                  alt={selectedMedia.alt_text || selectedMedia.original_name}
                  style={{
                    width: '100%',
                    borderRadius: '0.375rem',
                    marginBottom: '1rem'
                  }}
                />
              )}

              <div style={{ marginBottom: '1rem' }}>
                <p><strong>Filename:</strong> {selectedMedia.original_name}</p>
                <p><strong>Type:</strong> {selectedMedia.mime_type || 'Unknown'}</p>
                <p><strong>Size:</strong> {formatFileSize(selectedMedia.size)}</p>
                <p><strong>Uploaded:</strong> {new Date(selectedMedia.created_at).toLocaleDateString()}</p>
              </div>

              <div className="admin-form-group">
                <label className="admin-label">URL</label>
                <input
                  type="text"
                  value={selectedMedia.path}
                  readOnly
                  className="admin-input"
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => navigator.clipboard.writeText(selectedMedia.path)}
                  className="admin-btn admin-btn-secondary"
                >
                  Copy URL
                </button>
                <button
                  onClick={() => handleDelete(selectedMedia.id)}
                  className="admin-btn admin-btn-danger"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <p style={{ color: '#6b7280' }}>
              Select a file to view details
            </p>
          )}
        </div>
      </div>
    </AdminLayout>
  )
}
