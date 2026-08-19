/**
 * The fields an author should not have to fill in.
 *
 * A slug and an excerpt are derivable from a title and a body, and asking for
 * them by hand produces exactly two outcomes: a post with no slug (so its URL
 * is an id) and a listing with no summary (so it shows the first paragraph of
 * raw Markdown, hashes and all). Every CMS people arrive from fills both in and
 * lets you override them, so this does too.
 *
 * Derivation happens on write rather than on read. A slug computed per request
 * is not a permalink — it would follow the title around, breaking every link to
 * the post the first time someone fixed a typo in a headline.
 */

import { getDb } from '@basicbenframework/core/db'
import { slugify, excerpt } from '@basicbenframework/core/content'

/** Tables with a `slug` column. Named as a union so no caller can pass SQL. */
export type Sluggable = 'posts' | 'pages' | 'users'

/**
 * A slug for this table that nothing else is using.
 *
 * `posts.slug` and `pages.slug` are uniquely indexed, so a collision is not a
 * cosmetic problem — it is a failed write in the middle of someone's save. Two
 * posts called "Hello world" is ordinary, so the second becomes `hello-world-2`
 * the way WordPress numbers them, rather than being refused.
 *
 * @param table - which table the slug has to be unique within
 * @param desired - a slug or the text to make one from; slugified either way
 * @param options.excludeId - the row being updated, so it does not collide with itself
 * @param options.fallback - used when `desired` slugifies to nothing at all
 */
export async function uniqueSlug(
  table: Sluggable,
  desired: string,
  options: { excludeId?: number; fallback?: string } = {}
): Promise<string> {
  const db = await getDb()
  const base = slugify(desired || '') || options.fallback || table.replace(/s$/, '')

  const sql = options.excludeId
    ? `SELECT id FROM ${table} WHERE slug = ? AND id != ?`
    : `SELECT id FROM ${table} WHERE slug = ?`

  let slug = base
  let suffix = 2

  // Bounded by how many rows already hold this base, so it terminates.
  while (
    await db.get(sql, options.excludeId ? [slug, options.excludeId] : [slug])
  ) {
    slug = `${base}-${suffix++}`
  }

  return slug
}

/**
 * A plain-text summary of a body of Markdown.
 *
 * Thin on purpose: the framework already renders and strips, and a second
 * implementation here would be a second answer to "what is a summary" — one of
 * which would end mid-word.
 */
export function summarise(content: string | undefined | null, length = 200): string {
  return excerpt(content || '', length)
}

/**
 * The slug and excerpt to store, given what the author actually filled in.
 *
 * Three cases, and they are different on purpose:
 *
 *   - **Typed**: theirs. Slugified, made unique, otherwise untouched.
 *   - **Blank**: derive one. An empty box is how you ask for a fresh slug after
 *     retitling, and how you go back to an automatic summary.
 *   - **Absent**: leave what is there. A client that patches a title has not
 *     said anything about the slug, and a permalink that moved because someone
 *     fixed a typo in a headline is a broken link on every site that linked to
 *     it.
 *
 * `existing*` are what make the third case possible; without them "absent" and
 * "blank" collapse into each other.
 */
export async function derivedFields(
  table: Sluggable,
  input: { title?: string; content?: string; slug?: string; excerpt?: string },
  options: {
    excludeId?: number
    existingSlug?: string | null
    existingExcerpt?: string | null
  } = {}
): Promise<{ slug: string; excerpt: string }> {
  const slugMentioned = input.slug !== undefined
  const typed = (input.slug || '').trim()

  const slug =
    !slugMentioned && options.existingSlug
      ? options.existingSlug
      : await uniqueSlug(table, typed || input.title || '', { excludeId: options.excludeId })

  const excerptMentioned = input.excerpt !== undefined
  const typedExcerpt = (input.excerpt || '').trim()

  const summary = excerptMentioned
    ? typedExcerpt || summarise(input.content)
    : options.existingExcerpt ?? summarise(input.content)

  return { slug, excerpt: summary }
}
