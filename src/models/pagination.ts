/**
 * How many rows a listing may ask for at once.
 *
 * The admin tables were unpaginated: every post and every page came back on
 * every load, so the query, the JSON and the DOM all grew without limit. A
 * clamp rather than a default alone, because the page size arrives from the
 * query string and an unbounded one hands any caller a way to ask for the
 * whole table.
 */
export const MAX_PER_PAGE = 100
export const DEFAULT_PER_PAGE = 20

/**
 * Turn `page` and `per_page` query values into a safe window.
 *
 * Anything unparseable, negative or absurd collapses to the default rather
 * than erroring: a listing is not the place to argue about input, and a
 * malformed page number should show page one, not a 422.
 */
export function paginationFrom(query: Record<string, string> = {}) {
  const page = Math.max(1, Number.parseInt(query.page ?? '', 10) || 1)
  const requested = Number.parseInt(query.per_page ?? '', 10) || DEFAULT_PER_PAGE
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, requested))

  return { page, perPage, offset: (page - 1) * perPage }
}

/** The envelope a paginated listing returns, matching /api/v1's shape. */
export function meta(page: number, perPage: number, total: number) {
  return {
    page,
    per_page: perPage,
    total,
    // Computed here so no caller has to: total / per_page is the sum people
    // get wrong, and an off-by-one means a paging client either misses the
    // last page or loops forever on an empty one.
    total_pages: Math.max(1, Math.ceil(total / perPage))
  }
}
