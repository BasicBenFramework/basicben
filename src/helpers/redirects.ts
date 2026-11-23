/**
 * Automatic redirects when published content moves.
 *
 * Called from the post and page update paths. Kept out of the controllers so
 * each one gains a single line, and so the rule — which changes earn a
 * redirect, and what path each kind lives at — is written once.
 */

import { Redirect } from '../models/Redirect'
import { postPath, pagePath } from './content-paths'

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
  after: Movable | null | undefined
): Promise<void> {
  if (!after || !before.slug || !after.slug || before.slug === after.slug) return
  if (!before.published || before.deleted_at) return

  const path = kind === 'post' ? postPath : pagePath

  await recordSlugChange(kind, path(before.slug), path(after.slug))
}
