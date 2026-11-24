/**
 * The member on a request, added to core's Request type for this feature's
 * code. Set by middleware.ts; core never reads it (core sees only the opaque
 * `viewer` the access policy returns).
 */

import type { MemberRow } from './Member.ts'

declare module '../../types' {
  interface Request {
    /** The signed-in reader, or null when the request carried no valid member session. Never an admin principal. */
    member?: MemberRow | null
  }
}

export {}
