/**
 * Automatic redirects when published content moves.
 *
 * Called from the post and page update paths. Kept out of the controllers so
 * each one gains a single line, and so the rule — which changes earn a
 * redirect, and what path each kind lives at — is written once.
 */

import { Redirect } from '../models/Redirect'
import { entryPath, pagePath } from './content-paths'
import { routeBaseFor } from '../models/ContentType'

/**
 * Record that `kind` content moved from `oldPath` to `newPath`: a 301 from the
 * old path, chains collapsed, loops avoided. See `Redirect.recordSlugChange`.
 *
 * Never throws. The save that triggered this has already been written; failing
 * the request now would tell the editor their change was lost when it was not.
 * A missed redirect is logged and can be added by hand.
 */
export async function recordSlugChange(kind: 'post' | 'page', oldPath: string, newPath: string): Promise<void> {
  try {
    await Redirect.recordSlugChange(kind, oldPath, newPath)
  } catch (error) {
    console.error(`[redirects] could not record ${kind} move ${oldPath} -> ${newPath}:`, error)
  }
}

/**
 * Content now lives at `path`: drop any redirect away from it, which would
 * otherwise shadow it. Never throws, for the same reason as above.
 */
export async function releasePath(path: string): Promise<void> {
  try {
    await Redirect.releasePath(path)
  } catch (error) {
    console.error(`[redirects] could not release ${path}:`, error)
  }
}

interface Movable {
  id: number
  slug?: string | null
  published?: boolean | number | null
  deleted_at?: string | null
  /** The post's content type key; absent or `post` means `/blog`. */
  post_type?: string | null
}

/** A content type's route base, or null for the built-in type. Never throws. */
async function baseFor(type: string | null | undefined): Promise<string | null> {
  if (!type || type === 'post') return null
  try {
    return await routeBaseFor(type)
  } catch {
    return null
  }
}

/**
 * Compare a post or page before and after an update, and redirect if its
 * public URL changed.
 *
 * Only content that was public before the save: a draft's slug was never a
 * URL anyone could have linked to, so redirecting from it would only litter
 * the table. A post without a slug answered to its id, and still does — the
 * content API accepts an id wherever it accepts a slug — so it needs nothing.
 */
export async function redirectIfSlugChanged(
  kind: 'post' | 'page',
  before: Movable,
  after: Movable | null | undefined,
  // A post of a custom content type lives under its type's route base, and
  // changing its type moves it as surely as changing its slug. Omitted, both
  // are `/blog` — exactly the behaviour before content types existed.
  routeBases: { before?: string | null; after?: string | null } = {}
): Promise<void> {
  if (!after || !before.slug || !after.slug) return
  if (!before.published || before.deleted_at) return

  // Looked up from the rows themselves when the caller did not say, so the
  // controller's one-line call covers custom types without knowing about them.
  // A plain post never touches the database here.
  const beforeBase = routeBases.before !== undefined ? routeBases.before : await baseFor(before.post_type)
  const afterBase = routeBases.after !== undefined
    ? routeBases.after
    : after.post_type === before.post_type ? beforeBase : await baseFor(after.post_type)

  const from = kind === 'post' ? entryPath(beforeBase, before.slug) : pagePath(before.slug)
  const to = kind === 'post' ? entryPath(afterBase, after.slug) : pagePath(after.slug)

  if (from === to) return

  await recordSlugChange(kind, from, to)
}
