/**
 * Restricted posts: which ones are gated, and what a reader without access
 * gets instead of the body.
 *
 * The rule in one place, for the same reason `livePost` is in one place: the
 * content API, the feeds and the built-in blog all serve post bodies, and a
 * second copy of "is this gated?" is the copy that forgets a level. What a
 * level means is the access policy's business (helpers/access.ts); what
 * withholding removes is decided here.
 *
 * `viewer` below is what `viewerOf(req)` returned: null for an anonymous
 * reader.
 *
 * No database access, so tests import it directly.
 */

import { isRestricted, mayRead, visibilityOf } from './access.ts'

export { visibilityOf }

/** Does reading this post's body need more than an anonymous visit? */
export function isGated(visibility: unknown): boolean {
  return isRestricted(visibility)
}

/** Whether *this reader* may have the body of a post with this visibility. */
export function mayReadBody(visibility: unknown, viewer: unknown): boolean {
  return mayRead({ visibility }, viewer)
}

/**
 * A post row with its body removed, for a reader who may not have it.
 *
 * Both columns, always: the Markdown source is the body just as much as the
 * render is, and a surface that blanked one and forgot the other would leak
 * the post in whichever format it forgot. Everything else — title, excerpt,
 * image, dates — stays, because a listing of what members get is the point.
 */
export function withholdBody<T extends Record<string, unknown>>(row: T, viewer: unknown): T & { gated: boolean } {
  if (mayRead(row, viewer)) return { ...row, gated: false }

  // `content_html` is the render, so its text is the body's text. Stripped
  // crudely here — this file stays free of imports — which only has to be
  // good enough to tell a teaser from the whole post.
  const html = String(row.content_html ?? row.content ?? '')
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  const excerpt = publicExcerpt(row.excerpt as string | null | undefined, text, row.visibility, viewer)

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
  viewer: unknown
): string | null {
  if (!excerpt) return excerpt ?? null
  if (mayReadBody(visibility, viewer)) return excerpt

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
