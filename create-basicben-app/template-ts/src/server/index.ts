/**
 * Server entry point
 *
 * For TypeScript projects, routes must be explicitly imported
 * so Vite can bundle them during SSR build.
 */

import { createServer, createRouter } from '@basicbenframework/core/server'

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
import pluginsRoutes from '../routes/api/plugins'
import adminRoutes from '../routes/api/admin'

// Plugins are imported for the same reason routes are: a static import is
// something the bundler can follow, so the plugin is still there after a
// production build. A directory scan is not — it reads the source tree at
// runtime, which a deployed bundle does not have.
import helloWorld from '../../plugins/hello-world'

// Determine static directory based on environment
// In production, static files are in dist/client (relative to app root/cwd)
const staticDir = process.env.NODE_ENV === 'production' ? 'dist/client' : 'public'

const app = await createServer({
  // Disable auto-loading since we're importing routes explicitly
  autoloadRoutes: false,
  // Serve static files from appropriate directory.
  // spa serves index.html for unmatched client routes, so deep links and
  // refreshes work in production instead of returning a JSON 404
  static: { dir: staticDir, spa: true },
  // Plugins registered explicitly. Set `plugins: true` to rely on the
  // directory scan alone, or `pluginsDir: false` to turn the scan off and load
  // only what is listed here.
  plugins: [helloWorld],
  // Still scanned, which is convenient in development: drop a file into
  // plugins/ and restart, no edit here. A name listed above is not registered
  // twice.
  pluginsDir: 'plugins'
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
pluginsRoutes(router)
adminRoutes(router)
router.applyTo(app)

const port = process.env.PORT || 3001

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
