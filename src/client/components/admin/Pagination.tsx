import { useT } from '../../i18n'

export interface PageMeta {
  page: number
  per_page: number
  total: number
  total_pages: number
}

interface PaginationProps {
  meta: PageMeta
  onChange: (page: number) => void
  /**
   * What is being counted, for the summary line. The listings pass the English
   * plural ("posts"), which is translated here; anything else is shown as given.
   */
  noun?: string
}

/**
 * Pager for the admin tables.
 *
 * The listings were unpaginated: every row came back on every load, so the
 * query, the response and the table all grew with the content. This pages on
 * the server — the count in `meta` comes from the database, not from the rows
 * on screen, so "241 posts" stays true when only twenty are rendered.
 *
 * Renders nothing at a single page. A pager that shows "1 of 1" is furniture.
 */
export function Pagination({ meta, onChange, noun = 'items' }: PaginationProps) {
  const { t } = useT()
  if (meta.total_pages <= 1) return null

  const nouns: Record<string, string> = {
    items: t('items'),
    posts: t('posts'),
    pages: t('pages'),
    comments: t('comments'),
    members: t('members'),
    users: t('users'),
    redirects: t('redirects')
  }

  const first = (meta.page - 1) * meta.per_page + 1
  const last = Math.min(meta.page * meta.per_page, meta.total)

  return (
    <div className="admin-pagination">
      <p className="admin-pagination-summary">
        {t('{first}–{last} of {total} {noun}', { first, last, total: meta.total, noun: nouns[noun] ?? noun })}
      </p>

      <div className="admin-pagination-controls">
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          onClick={() => onChange(meta.page - 1)}
          disabled={meta.page <= 1}
        >
          {t('Previous')}
        </button>

        <span className="admin-pagination-position">
          {t('Page {page} of {pages}', { page: meta.page, pages: meta.total_pages })}
        </span>

        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          onClick={() => onChange(meta.page + 1)}
          disabled={meta.page >= meta.total_pages}
        >
          {t('Next')}
        </button>
      </div>
    </div>
  )
}
