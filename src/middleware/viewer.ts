/**
 * Identify the reader for a content read, and carry on either way.
 *
 * Asks the site's access policy (helpers/access.ts) who is reading, and
 * remembers the answer on the request for the controller and gating to use.
 * With no policy, or no credential, the reader is anonymous: the request was
 * allowed without one, so it is served what anyone is served.
 *
 * Named export only: a default export in src/middleware is applied to every
 * route by the framework's autoloader.
 */

import { viewerOf } from '../helpers/access.ts'
import type { Request, Response } from '../types/index.ts'

export const identifyViewer = async (req: Request, _res: Response, next: () => void) => {
  await viewerOf(req)
  next()
}
