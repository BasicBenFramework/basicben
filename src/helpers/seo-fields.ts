/**
 * The social-card and indexing fields a post or page editor sends.
 *
 * Shared by both controllers so the two cannot accept different things. Absent
 * keys stay absent, so a client that knows nothing about these fields does not
 * blank them on save.
 */
export function seoFields(body: unknown):
  | { values: Record<string, unknown> }
  | { errors: Record<string, string[]> } {
  const payload = (body ?? {}) as Record<string, unknown>
  const values: Record<string, unknown> = {}
  const errors: Record<string, string[]> = {}

  for (const key of ['og_title', 'og_description', 'twitter_title', 'twitter_description']) {
    if (key in payload) {
      const value = payload[key]
      values[key] = typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null
    }
  }

  // Media ids or nothing. The empty string an unset picker sends would
  // otherwise become a foreign key of '' and fail the write.
  for (const key of ['og_image', 'twitter_image']) {
    if (key in payload) {
      const id = Number(payload[key])
      values[key] = Number.isInteger(id) && id > 0 ? id : null
    }
  }

  // Emitted into the <head> of every page that renders this, so only an
  // absolute http(s) URL is accepted.
  if ('canonical_url' in payload) {
    const raw = String(payload.canonical_url ?? '').trim()
    if (!raw) {
      values.canonical_url = null
    } else {
      try {
        const url = new URL(raw)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
        values.canonical_url = url.toString()
      } catch {
        errors.canonical_url = ['Canonical URL must be an absolute http or https URL']
      }
    }
  }

  if ('noindex' in payload) values.noindex = payload.noindex ? 1 : 0

  return Object.keys(errors).length ? { errors } : { values }
}

export const SEO_COLUMNS = [
  'og_title', 'og_description', 'og_image', 'twitter_title', 'twitter_description',
  'twitter_image', 'canonical_url', 'noindex'
]
