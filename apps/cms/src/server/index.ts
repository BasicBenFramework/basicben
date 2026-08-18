/**
 * Server entry point
 *
 * For TypeScript projects, routes must be explicitly imported
 * so Vite can bundle them during SSR build.
 */

import { createServer, createRouter } from '@basicbenframework/core/server'

// Registers the application's hook listeners. Imported for its side effects —
// the listeners have to be on the registry before the server starts.
import '../hooks'

// Import routes explicitly for Vite bundling
import authRoutes from '../routes/api/auth'
import verificationRoutes from '../routes/api/verification'
import twoFactorRoutes from '../routes/api/two-factor'
import passkeyRoutes from '../routes/api/passkeys'
import postsRoutes from '../routes/api/posts'
import profileRoutes from '../routes/api/profile'
import categoriesRoutes from '../routes/api/categories'
import tagsRoutes from '../routes/api/tags'
import pagesRoutes from '../routes/api/pages'
import commentsRoutes from '../routes/api/comments'
import mediaRoutes from '../routes/api/media'
import settingsRoutes from '../routes/api/settings'
import feedRoutes from '../routes/api/feed'
import adminRoutes from '../routes/api/admin'
import tokensRoutes from '../routes/api/tokens'
import v1Routes from '../routes/api/v1'

// Determine static directory based on environment
// In production, static files are in dist/client (relative to app root/cwd)
const staticDir = process.env.NODE_ENV === 'production' ? 'dist/client' : 'public'

const app = await createServer({
  // Disable auto-loading since we're importing routes explicitly
  autoloadRoutes: false,
  // Serve static files from appropriate directory.
  // spa serves index.html for unmatched client routes, so deep links and
  // refreshes work in production instead of returning a JSON 404
  static: { dir: staticDir, spa: true }
})

// Register routes
const router = createRouter()
authRoutes(router)
verificationRoutes(router)
twoFactorRoutes(router)
passkeyRoutes(router)
postsRoutes(router)
profileRoutes(router)
categoriesRoutes(router)
tagsRoutes(router)
pagesRoutes(router)
commentsRoutes(router)
mediaRoutes(router)
settingsRoutes(router)
feedRoutes(router)
adminRoutes(router)
tokensRoutes(router)
// The public content API. Versioned because its consumers are outside this
// repository, and read-only because the admin API already owns the writes.
v1Routes(router)
router.applyTo(app)

const port = process.env.PORT || 3001

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
