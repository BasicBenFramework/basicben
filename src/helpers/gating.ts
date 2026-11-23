/**
 * Members-only posts: which ones are gated, and what a reader without access
 * gets instead of the body.
 *
 * The rule in one place, for the same reason `livePost` is in one place: the
 * content API, the feeds and the built-in blog all serve post bodies, and a
 * second copy of "is this gated?" is the copy that forgets `paid`.
 *
 * No database access, so tests import it directly.
 */

/** Who may read a post's body. */
export const POST_VISIBILITIES = ['public', 'members', 'paid'] as const
export type PostVisibility = (typeof POST_VISIBILITIES)[number]

export function isPostVisibility(value: unknown): value is PostVisibility {
  return typeof value === 'string' && (POST_VISIBILITIES as readonly string[]).includes(value)
}

/** A stored value as a visibility. Anything unrecognised is public, which is what the column defaults to. */
export function visibilityOf(value: unknown): PostVisibility {
  return isPostVisibility(value) ? value : 'public'
}

/**
 * Does reading this post's body need a member session?
 *
 * `paid` is treated exactly like `members` until paid subscriptions exist —
 * see migration 034. When they do, this is the function that learns about
 * tiers, and every surface that serves a body follows.
 */
export function isGated(visibility: unknown): boolean {
  const value = visibilityOf(visibility)
  return value === 'members' || value === 'paid'
}

/**
 * Whether *this reader* may have the body.
 *
 * `member` is whether the request carried a valid member session. Kept as a
 * boolean rather than a member record: nothing here should depend on who the
 * member is until tiers exist.
 */
export function mayReadBody(visibility: unknown, member: boolean): boolean {
  return !isGated(visibility) || member
}

/**
 * A post row with its body removed, for a reader who may not have it.
 *
 * Both columns, always: the Markdown source is the body just as much as the
 * render is, and a surface that blanked one and forgot the other would leak
 * the post in whichever format it forgot. Everything else — title, excerpt,
 * image, dates — stays, because a listing of what members get is the point.
 */
export function withholdBody<T extends Record<string, unknown>>(row: T, member: boolean): T & { gated: boolean } {
  if (mayReadBody(row.visibility, member)) return { ...row, gated: false }

  // `content_html` is the render, so its text is the body's text. Stripped
  // crudely here — this file stays free of imports — which only has to be
  // good enough to tell a teaser from the whole post.
  const html = String(row.content_html ?? row.content ?? '')
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  const excerpt = publicExcerpt(row.excerpt as string | null | undefined, text, row.visibility, member)

  return { ...row, ...('excerpt' in row ? { excerpt } : {}), content: null, content_html: null, gated: true }
}

/**
 * The excerpt a reader who may not have the body is allowed to see.
 *
 * An automatic excerpt is the first 200 characters of the body, which on a
 * short post *is* the body: withholding `content` and publishing the excerpt
 * would gate nothing. So a gated post keeps its excerpt only when the excerpt
 * is shorter than the body's text — a teaser, the way every membership site
 * shows one. A typed excerpt that differs from the body is always kept.
 *
 * Whitespace is collapsed before comparing because the derived excerpt is.
 */
export function publicExcerpt(
  excerpt: string | null | undefined,
  bodyText: string | null | undefined,
  visibility: unknown,
  member: boolean
): string | null {
  if (!excerpt) return excerpt ?? null
  if (mayReadBody(visibility, member)) return excerpt

  const squash = (value: string) => value.replace(/\s+/g, ' ').trim().replace(/(\.\.\.|…)$/, '').trim()
  const text = squash(bodyText ?? '')
  const summary = squash(excerpt)

  return summary.length >= text.length || text === summary ? null : excerpt
}

/**
 * The body a feed item gets for a gated post: the excerpt and a pointer.
 *
 * Feeds are public documents, fetched by readers and aggregators that hold no
 * session, so a gated post's feed entry can never carry the body. It still
 * appears — a feed that silently skipped members-only posts would hide from
 * subscribers that there was anything to sign in for.
 */
export function gatedFeedHtml(excerpt: string | null | undefined, link?: string): string {
  const escape = (value: string) => value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const summary = excerpt ? `<p>${escape(excerpt)}</p>` : ''
  // The item's own link already points at the post; one in the body is a
  // convenience for readers that hide it.
  const notice = 'This post is for members. Sign in on the site to read it.'
  return `${summary}<p>${link ? `<a href="${escape(link)}">${notice}</a>` : notice}</p>`
}
