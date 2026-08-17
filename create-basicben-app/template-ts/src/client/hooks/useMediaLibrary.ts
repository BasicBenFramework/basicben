import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../helpers/api'

/**
 * The media library, shared by the admin page and the editor's picker.
 *
 * Both need the same three-step upload, the same pagination and the same
 * filters. Uploading is a protocol rather than a request — sign, PUT to
 * storage, confirm — so a second copy of it would drift from this one the
 * first time any step changed.
 */

/** What `POST /api/media/sign` hands back: a URL to PUT to, and the headers it was signed with. */
interface SignedUpload {
  uploadUrl?: string
  key?: string
  ticket?: string
  headers?: Record<string, string>
  expiresAt?: string
  error?: string
}

export interface MediaItem {
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

interface Pagination {
  page: number
  per_page: number
  total: number
  total_pages: number
}

export interface UploadProgress {
  name: string
  /** 0–100, or null before the browser reports any progress. */
  percent: number | null
  error?: string
}

const PER_PAGE = 24

/** Where a file is served from. Falls back to the key, which is all a local driver needs. */
export function mediaUrl(item: MediaItem) {
  return item.url || item.path
}

export function isImage(mimeType?: string) {
  return Boolean(mimeType?.startsWith('image/'))
}

export function useMediaLibrary() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [uploads, setUploads] = useState<UploadProgress[]>([])

  // Guards a race: a filter change while a page request is in flight would
  // otherwise append the old query's results to the new query's list.
  const requestId = useRef(0)

  const fetchPage = useCallback(
    async (nextPage: number, replace: boolean) => {
      const id = ++requestId.current

      if (replace) setLoading(true)
      else setLoadingMore(true)

      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          per_page: String(PER_PAGE)
        })
        if (search) params.set('search', search)
        if (type) params.set('type', type)

        const res = await api.get<{ media: MediaItem[]; pagination: Pagination }>(
          `/api/media?${params}`
        )

        if (id !== requestId.current) return

        const fetched = res?.media || []
        setItems(prev => (replace ? fetched : [...prev, ...fetched]))
        setPage(res?.pagination?.page || nextPage)
        setTotalPages(res?.pagination?.total_pages || 1)
        setTotal(res?.pagination?.total || fetched.length)
      } catch (error) {
        if (id === requestId.current) console.error('Failed to load media:', error)
      } finally {
        if (id === requestId.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [search, type]
  )

  // Refetch from the first page whenever the query changes. Debounced so typing
  // in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => fetchPage(1, true), search ? 250 : 0)
    return () => clearTimeout(timer)
  }, [fetchPage, search])

  const hasMore = page < totalPages

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return
    fetchPage(page + 1, false)
  }, [fetchPage, hasMore, loading, loadingMore, page])

  /**
   * Upload one file: sign, PUT the bytes straight to storage, confirm.
   *
   * The bytes never pass through the API, which is why there is no FormData
   * here and no limit imposed by the server's body parser. XHR rather than
   * fetch, because only XHR reports upload progress.
   */
  const uploadOne = async (file: File, onProgress: (percent: number) => void) => {
    const signed = await api.post<SignedUpload>('/api/media/sign', {
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size
    })

    if (!signed?.uploadUrl) {
      throw new Error(signed?.error || 'Could not start the upload.')
    }

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', signed.uploadUrl!)

      // The signature covers the content type, so the headers have to go up
      // exactly as they were signed or storage refuses the request.
      for (const [header, headerValue] of Object.entries(signed.headers || {})) {
        xhr.setRequestHeader(header, headerValue)
      }

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Storage refused the upload (${xhr.status}).`))
      xhr.onerror = () => reject(new Error('The upload could not reach storage.'))
      xhr.send(file)
    })

    const confirmed = await api.post<{ media?: MediaItem; error?: string }>('/api/media/confirm', {
      key: signed.key,
      ticket: signed.ticket,
      filename: file.name
    })

    if (!confirmed?.media) {
      throw new Error(confirmed?.error || 'The upload could not be confirmed.')
    }

    return confirmed.media
  }

  /**
   * Upload a batch, reporting progress per file.
   *
   * Sequential, and one rejection does not discard the rest — a file refused
   * for its type should not lose the four beside it that worked.
   */
  const upload = async (files: File[]) => {
    if (files.length === 0) return []

    setUploads(files.map(file => ({ name: file.name, percent: null })))

    const uploaded: MediaItem[] = []

    for (const [index, file] of files.entries()) {
      try {
        const item = await uploadOne(file, percent =>
          setUploads(prev => prev.map((u, i) => (i === index ? { ...u, percent } : u)))
        )
        uploaded.push(item)
        setUploads(prev => prev.map((u, i) => (i === index ? { ...u, percent: 100 } : u)))
      } catch (error) {
        setUploads(prev =>
          prev.map((u, i) => (i === index ? { ...u, error: (error as Error).message } : u))
        )
      }
    }

    if (uploaded.length > 0) {
      setItems(prev => [...uploaded, ...prev])
      setTotal(prev => prev + uploaded.length)
    }

    // Leave failures on screen; a message that vanishes is a message nobody read.
    setUploads(prev => (prev.some(u => u.error) ? prev : []))

    return uploaded
  }

  const dismissUploads = () => setUploads([])

  const remove = async (ids: number[]) => {
    const removed: number[] = []

    for (const id of ids) {
      try {
        await api.delete(`/api/media/${id}`)
        removed.push(id)
      } catch {
        // Reported by the caller; one failure should not abandon the batch.
      }
    }

    if (removed.length > 0) {
      setItems(prev => prev.filter(item => !removed.includes(item.id)))
      setTotal(prev => prev - removed.length)
    }

    return removed
  }

  const saveAlt = async (id: number, alt: string) => {
    const res = await api.put<{ media: MediaItem }>(`/api/media/${id}`, { alt_text: alt })
    const updated = res?.media
    if (!updated) throw new Error('The update returned no media.')

    setItems(prev => prev.map(item => (item.id === updated.id ? updated : item)))
    return updated
  }

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    total,
    search,
    setSearch,
    type,
    setType,
    uploads,
    dismissUploads,
    loadMore,
    upload,
    remove,
    saveAlt,
    reload: () => fetchPage(1, true)
  }
}
