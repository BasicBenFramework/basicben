/**
 * Who may read a restricted post's body: core's mechanism, one feature's policy.
 *
 * A post's `visibility` is `public` or a level some policy understands
 * (`members`, `paid`). Core never decides what a level means. It asks the one
 * registered policy, through `mayRead`, and every surface that serves a body —
 * the content API, the feeds, the built-in blog, the theme — goes through
 * helpers/gating.ts, which goes through here.
 *
 * - **One policy, not a chain.** A second registration throws at boot. A chain
 *   would let a later listener turn a deny into an allow.
 * - **Deny by default.** With no policy, public posts are readable and nothing
 *   else is: a site that removes the members feature keeps its members-only
 *   posts withheld rather than publishing them. If the policy throws, the
 *   answer is no.
 *
 * No database access and no imports, so tests and gating.ts load it directly.
 */

/** A reader the policy recognised. Opaque to core: only the policy looks inside. */
export type Viewer = object

export interface AccessPolicy<V extends Viewer = Viewer> {
  /** The levels beyond `public` the editor offers, such as `members`. */
  levels: string[]
  /** Request headers that carry the reader's credential. Core treats them like Authorization for caching. */
  headers: string[]
  /** The reader behind a request, or null. */
  identify(req: any): V | null | Promise<V | null>
  /** Whether this reader may have this post's body. Only asked for a restricted post and a known reader. */
  mayRead(post: { visibility?: unknown }, viewer: V): boolean
}

export const PUBLIC = 'public'

let policy: AccessPolicy<any> | null = null

export function setAccessPolicy(next: AccessPolicy<any>): void {
  if (policy) throw new Error('An access policy is already registered; there can be only one')
  if (!Array.isArray(next.levels) || next.levels.includes(PUBLIC)) throw new Error('Access levels must be a list, and not include "public"')
  for (const level of next.levels) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(level)) throw new Error(`Access level "${level}" must be a short lower-case name`)
  }
  policy = { ...next, headers: [...(next.headers ?? [])] }
}

/** For tests: forget the policy. */
export function clearAccessPolicy(): void {
  policy = null
}

export function hasAccessPolicy(): boolean {
  return policy !== null
}

/** Every level a post may be saved with: `public`, then the policy's. */
export function accessLevels(): string[] {
  return [PUBLIC, ...(policy?.levels ?? [])]
}

/** The headers that carry a reader's credential, as the policy spelled them. */
export function credentialHeaders(): string[] {
  return policy?.headers ?? []
}

/** A stored visibility as a string. Blank or missing is `public`, which is what the column defaults to. */
export function visibilityOf(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : PUBLIC
}

/** Does this visibility restrict the body at all? Anything but public does. */
export function isRestricted(visibility: unknown): boolean {
  return visibilityOf(visibility) !== PUBLIC
}

/**
 * May this reader have this post's body?
 *
 * `viewer` is what `viewerOf` returned for the request; null (or anything
 * falsy) is an anonymous reader. Never throws.
 */
export function mayRead(post: { visibility?: unknown }, viewer: unknown): boolean {
  if (!isRestricted(post.visibility)) return true
  if (!policy || !viewer) return false

  try {
    return policy.mayRead(post, viewer as Viewer) === true
  } catch {
    return false
  }
}

/**
 * The reader behind a request, asked of the policy once per request and
 * remembered on it. Null with no policy, no credential, or a policy that
 * throws.
 */
export async function viewerOf(req: { viewer?: Viewer | null } & Record<string, any>): Promise<Viewer | null> {
  if (req.viewer !== undefined) return req.viewer

  let viewer: Viewer | null = null
  if (policy) {
    try {
      viewer = (await policy.identify(req)) ?? null
    } catch {
      viewer = null
    }
  }

  req.viewer = viewer
  return viewer
}
