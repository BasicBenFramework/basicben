/**
 * When a post is on the public site.
 *
 * Published, not in the trash, and its publish time has arrived. Every public
 * read — the content API, the feeds, the sitemap, taxonomy and author counts,
 * comments — goes through this one fragment, because a second copy of the rule
 * is the copy that forgets the schedule.
 *
 * The cutoff is inlined as a literal rather than bound, so the fragment drops
 * into any query without disturbing its placeholders. It is safe to inline: it
 * is always our own `toISOString()`, never input. ISO-8601 UTC strings compare
 * correctly as text on SQLite and cast to a timestamp on Postgres.
 *
 * Scheduling needs no cron: a scheduled post simply starts matching when its
 * time comes. What does need a tick is telling webhooks — see `publishDue()` in
 * `src/hooks.ts`.
 */
export function livePost(alias = 'posts'): string {
  const now = new Date().toISOString()
  return `(${alias}.published = 1 AND ${alias}.deleted_at IS NULL AND (${alias}.publish_at IS NULL OR ${alias}.publish_at <= '${now}'))`
}

/** Normalise a date to the stored form, or null. Throws on nonsense. */
export function toStoredTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(value as string)
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date')
  return date.toISOString()
}

/** The editorial states a post can be in. Scheduled is published-in-the-future. */
export const POST_STATUSES = ['draft', 'pending', 'published'] as const
export type PostStatus = (typeof POST_STATUSES)[number]

/**
 * Read a stored timestamp as UTC.
 *
 * SQLite's CURRENT_TIMESTAMP writes `YYYY-MM-DD HH:MM:SS` with no zone, and
 * `new Date()` reads that as *local* time — off by the server's offset. Rows
 * written by the app carry a `Z`; this makes the two agree.
 */
export function parseStoredTimestamp(value: string | Date | null | undefined): number {
  if (!value) return NaN
  if (value instanceof Date) return value.getTime()
  const bare = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
  return new Date(bare ? `${value.replace(' ', 'T')}Z` : value).getTime()
}
