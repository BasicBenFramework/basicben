/**
 * Server entry point
 *
 * Customize here for websockets, custom middleware, etc.
 */

import { createServer } from '@basicbenframework/core/server'

// Determine static directory based on environment
// In production, static files are in dist/client (relative to app root/cwd)
const staticDir = process.env.NODE_ENV === 'production' ? 'dist/client' : 'public'

const app = await createServer({
  // spa serves index.html for unmatched client routes, so deep links and
  // refreshes work in production instead of returning a JSON 404
  static: { dir: staticDir, spa: true }
})

const port = process.env.PORT || 3001

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
