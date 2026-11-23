import { useEffect, useState } from 'react'
import { api } from '../../helpers/api'

/** A content type as the admin API returns it — the parts the editor reads. */
export interface AdminContentType {
  id: number
  key: string
  singular_label: string
  plural_label: string
  route_base: string
  builtin: boolean
  public: boolean
  supports: {
    excerpt: boolean
    featured_image: boolean
    comments: boolean
    categories: boolean
    tags: boolean
    custom_fields: boolean
  }
  fields: Array<{
    key: string
    label: string
    type: 'text' | 'textarea' | 'number' | 'url' | 'date' | 'boolean' | 'select'
    options: string[]
    required: boolean
    help_text: string | null
  }>
}

/**
 * Every content type, for the listing's type switcher and the editor's panels.
 *
 * Empty until loaded, and on failure — in which case the screens behave as
 * they did before content types existed, which is the safe way to be wrong.
 */
export function useContentTypes(): { types: AdminContentType[]; loaded: boolean } {
  const [types, setTypes] = useState<AdminContentType[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    api.get<{ content_types: AdminContentType[] }>('/api/content-types')
      .then(res => { if (live) setTypes(res?.content_types || []) })
      .catch(() => { if (live) setTypes([]) })
      .finally(() => { if (live) setLoaded(true) })
    return () => { live = false }
  }, [])

  return { types, loaded }
}

/** `?type=` from the address bar, or null. */
export function typeFromQuery(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('type')
  } catch {
    return null
  }
}

/**
 * Go to an admin route and carry `?type=` with it.
 *
 * The client router matches its whole `path` state, query string included, so
 * `navigate('/admin/posts?type=recipe')` would match no route at all. Navigate
 * to the bare path, then put the query back into the address bar: the router
 * still matches the path, and the screen it renders reads the type from
 * `location.search` — which also survives a reload.
 */
export function navigateWithType(navigate: (to: string) => void, path: string, type: string | null | undefined): void {
  navigate(path)
  if (type && type !== 'post') {
    window.history.replaceState({}, '', `${path}?type=${encodeURIComponent(type)}`)
  }
}
