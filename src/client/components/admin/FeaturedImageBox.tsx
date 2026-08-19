import { useState } from 'react'
import MediaPicker from './MediaPicker'
import { MediaItem, isImage, mediaUrl } from '../../hooks/useMediaLibrary'

/**
 * The featured image panel, for posts and for pages.
 *
 * One component rather than one per content type: the two editors would
 * otherwise each grow their own copy, and the second would be the one that
 * forgets to send null when the image is removed.
 *
 * What it stores is a media id. The preview needs a URL, which the server
 * resolves through the storage adapter — so both travel: `value` is what gets
 * saved, `url` is what gets shown.
 */

interface FeaturedImageBoxProps {
  value: number | null
  url: string | null
  onChange: (image: { id: number; url: string } | null) => void
}

export default function FeaturedImageBox({ value, url, onChange }: FeaturedImageBoxProps) {
  const [picking, setPicking] = useState(false)

  const choose = (item: MediaItem) => {
    // A PDF as a hero image is a broken <img>, not a design decision.
    if (!isImage(item.mime_type)) {
      alert('A featured image has to be an image.')
      return
    }

    onChange({ id: item.id, url: mediaUrl(item) })
    setPicking(false)
  }

  return (
    <div className="admin-card">
      <h3 className="admin-card-title">Featured image</h3>

      {value && url ? (
        <div>
          <img
            src={url}
            alt=""
            style={{
              width: '100%',
              borderRadius: '0.375rem',
              display: 'block',
              marginBottom: '0.5rem'
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => setPicking(true)}
            >
              Replace
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-danger"
              onClick={() => onChange(null)}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="admin-term-add"
          onClick={() => setPicking(true)}
        >
          + Set featured image
        </button>
      )}

      {picking && <MediaPicker onSelect={choose} onClose={() => setPicking(false)} />}
    </div>
  )
}
