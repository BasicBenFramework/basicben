import { useEffect, useState } from 'react'
import MediaPicker from './MediaPicker.tsx'
import { MediaItem, isImage, mediaUrl } from '../../hooks/useMediaLibrary.ts'
import { api } from '../../../helpers/api.ts'
import { useT } from '../../i18n/index.ts'

/**
 * The image on a social card — Open Graph or Twitter / X — for posts and pages.
 *
 * The same media library picker as the featured image, because the column is
 * the same kind of thing: a media id, which the server turns into a URL
 * through the storage adapter. A pasted URL is accepted too, and resolved to
 * the library item it serves (`GET /api/media?url=`): the column cannot hold a
 * URL from somewhere else, and storing one would put an address on every
 * shared link that nothing here can check or move.
 *
 * Empty is the common case and means "fall back" — to the Open Graph image,
 * then the featured image — so the empty state says which.
 */

interface SocialImageFieldProps {
  id: string
  label: string
  /** What a blank field falls back to, said in the empty state. */
  fallback: string
  value: number | null
  onChange: (id: number | null) => void
  disabled?: boolean
}

export default function SocialImageField({ id, label, fallback, value, onChange, disabled }: SocialImageFieldProps) {
  const { t } = useT()
  const [picking, setPicking] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)

  // A saved post carries only the id, so the preview asks for the rest.
  useEffect(() => {
    if (!value) {
      setUrl(null)
      return
    }
    let current = true
    api.get<{ media: MediaItem }>(`/api/media/${value}`)
      .then(res => { if (current && res?.media) setUrl(mediaUrl(res.media)) })
      .catch(() => { if (current) setUrl(null) })
    return () => { current = false }
  }, [value])

  const choose = (item: MediaItem) => {
    if (!isImage(item.mime_type)) {
      setError(t('A social card image has to be an image.'))
      return
    }
    setError(null)
    setUrl(mediaUrl(item))
    onChange(item.id)
    setPicking(false)
  }

  const applyPasted = async () => {
    const address = pasted.trim()
    if (!address || resolving) return
    setResolving(true)
    setError(null)
    try {
      const res = await api.get<{ media: MediaItem[] }>(`/api/media?${new URLSearchParams({ url: address, per_page: '5' })}`)
      const match = (res?.media ?? []).find(item => isImage(item.mime_type))
      if (match) {
        choose(match)
        setPasted('')
      } else {
        setError(t('That URL is not an image in the media library. Upload it first, then choose it here.'))
      }
    } catch {
      setError(t('Could not look that URL up.'))
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="admin-form-group">
      <label className="admin-label" htmlFor={`${id}-url`}>{label}</label>

      {value ? (
        <div>
          {url && (
            <img src={url} alt="" style={{ width: '100%', maxWidth: '320px', borderRadius: '0.375rem', display: 'block', marginBottom: '0.5rem' }} />
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="admin-btn admin-btn-secondary" disabled={disabled} onClick={() => setPicking(true)}>
              {t('Replace')}
            </button>
            <button type="button" className="admin-btn admin-btn-danger" disabled={disabled} onClick={() => { setUrl(null); onChange(null) }}>
              {t('Remove')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <small style={{ color: 'var(--fg-muted)' }}>{fallback}</small>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="admin-btn admin-btn-secondary" disabled={disabled} onClick={() => setPicking(true)}>
              {t('Choose image')}
            </button>
            <input
              id={`${id}-url`}
              type="url"
              value={pasted}
              disabled={disabled}
              onChange={event => { setPasted(event.target.value); setError(null) }}
              // Enter here would submit the whole post.
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void applyPasted()
                }
              }}
              className="admin-input"
              style={{ flex: '1 1 12rem' }}
              placeholder={t('or paste the URL of a library image')}
            />
            {pasted.trim() && (
              <button type="button" className="admin-btn admin-btn-secondary" disabled={disabled || resolving} onClick={() => void applyPasted()}>
                {resolving ? t('Looking…') : t('Use URL')}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <small role="alert" style={{ color: 'var(--danger)', display: 'block', marginTop: '0.25rem' }}>{error}</small>}

      {picking && <MediaPicker onSelect={choose} onClose={() => setPicking(false)} />}
    </div>
  )
}
