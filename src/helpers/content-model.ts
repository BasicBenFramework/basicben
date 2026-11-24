/**
 * Content types and custom taxonomies, as the post write path sees them.
 *
 * PostController is shared with other work, so what content types add to a
 * save lives here and the controller gains a line per step: work out the type
 * and validate its fields (`typeAndFields`), then sync custom terms
 * (`saveTerms`). Keeping the rules in one module also means the admin API and
 * any importer agree on them.
 */

import { ContentType, validateFieldValues, parseStoredFields, type ContentTypeRecord } from '../models/ContentType.ts'
import { Taxonomy } from '../models/Taxonomy.ts'
import { entryPath } from './content-paths.ts'

interface Existing {
  id: number
  post_type?: string | null
  fields?: unknown
}

/**
 * The `post_type` and `fields` a save should write, or the errors to refuse it.
 *
 * - **Create**: the type defaults to `post`, so every client written before
 *   content types existed keeps creating ordinary posts.
 * - **Update**: absent keys leave the stored values alone. Changing the type
 *   re-checks the stored fields against the new type's schema, because values
 *   that satisfied a recipe say nothing about whether a product is complete.
 *
 * A type whose `custom_fields` support is off stores no fields at all.
 */
export async function typeAndFields(
  body: unknown,
  existing: Existing | null
): Promise<{ values: Record<string, unknown> } | { errors: Record<string, string[]> }> {
  const payload = (body ?? {}) as Record<string, unknown>
  const values: Record<string, unknown> = {}

  const currentKey = existing?.post_type || 'post'
  let type: ContentTypeRecord | undefined

  if ('post_type' in payload) {
    const requested = String(payload.post_type ?? '').trim() || 'post'
    type = await ContentType.findByKey(requested)
    if (!type) return { errors: { post_type: [`Unknown content type "${requested}"`] } }
    if (!existing || requested !== currentKey) values.post_type = requested
  }

  const typeChanged = values.post_type !== undefined && existing !== null
  const fieldsSent = 'fields' in payload

  // Nothing about the type or its fields in this request: leave both alone.
  if (!fieldsSent && !typeChanged) return { values }

  type ??= await ContentType.findByKey(currentKey)
  if (!type) return { values }

  if (!type.supports.custom_fields || type.fields.length === 0) {
    // A type without fields stores none, so a value cannot hide in a post
    // until someone adds a field with that key later.
    values.fields = null
    return { values }
  }

  const source = fieldsSent ? payload.fields : parseStoredFields(existing?.fields)
  const checked = validateFieldValues(type.fields, source)
  if ('errors' in checked) return { errors: checked.errors }

  values.fields = Object.keys(checked.values).length ? JSON.stringify(checked.values) : null
  return { values }
}

/**
 * Sync a post's custom taxonomy terms after the row is written.
 *
 * `term_ids` absent leaves them alone, unless the type just changed — then the
 * existing terms are re-filtered, so a recipe turned into a post does not keep
 * a cuisine no post can have.
 */
export async function saveTerms(postId: number, body: unknown, typeChanged = false): Promise<void> {
  const payload = (body ?? {}) as { term_ids?: unknown }

  if (Array.isArray(payload.term_ids)) {
    await Taxonomy.syncPostTerms(postId, payload.term_ids)
  } else if (typeChanged) {
    await Taxonomy.syncPostTerms(postId, await Taxonomy.termIdsFor(postId))
  }
}

/** A post's public path, whatever its type. */
export async function publicPathOf(post: { slug?: string | null; id: number; post_type?: string | null }): Promise<string> {
  if (!post.post_type || post.post_type === 'post') return entryPath(null, post.slug, post.id)
  const type = await ContentType.findByKey(post.post_type)
  return entryPath(type?.route_base, post.slug, post.id)
}

/** What the editor needs beside the row: custom terms, and fields as an object. */
export async function editorExtras(post: Existing): Promise<{ term_ids: number[]; fields: Record<string, unknown> }> {
  return { term_ids: await Taxonomy.termIdsFor(post.id), fields: parseStoredFields(post.fields) }
}
