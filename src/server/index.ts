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
// Core's scheduled work, in the registry features add to.
import '../host/core-tasks'
import { registerFeatures, mountFeatureRoutes } from '../host'
import features from '../features'

// Import routes explicitly for Vite bundling
import authRoutes from '../routes/api/auth'
import verificationRoutes from '../routes/api/verification'
import twoFactorRoutes from '../routes/api/two-factor'
import passkeyRoutes from '../routes/api/passkeys'
import postsRoutes from '../routes/api/posts'
import profileRoutes from '../routes/api/profile'
import authorsRoutes from '../routes/api/authors'
import categoriesRoutes from '../routes/api/categories'
import tagsRoutes from '../routes/api/tags'
import pagesRoutes from '../routes/api/pages'
import commentsRoutes from '../routes/api/comments'
import mediaRoutes from '../routes/api/media'
import settingsRoutes from '../routes/api/settings'
import feedRoutes from '../routes/api/feed'
import adminRoutes from '../routes/api/admin'
import tokensRoutes from '../routes/api/tokens'
import usersRoutes from '../routes/api/users'
import v1Routes from '../routes/api/v1'
import cronRoutes from '../routes/api/cron'
import navigationRoutes from '../routes/api/navigation'
import redirectsRoutes from '../routes/api/redirects'
import snippetsRoutes from '../routes/api/snippets'
import exportRoutes from '../routes/api/export'
import opsRoutes from '../routes/api/ops'
import contentModelRoutes from '../routes/api/content-model'

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

// Features register their settings, tasks and routes before anything is
// mounted, so a settings save or a health check sees all of them.
await registerFeatures(features)

// Register routes
const router = createRouter()
authRoutes(router)
verificationRoutes(router)
twoFactorRoutes(router)
passkeyRoutes(router)
postsRoutes(router)
profileRoutes(router)
authorsRoutes(router)
categoriesRoutes(router)
tagsRoutes(router)
pagesRoutes(router)
commentsRoutes(router)
mediaRoutes(router)
settingsRoutes(router)
feedRoutes(router)
adminRoutes(router)
tokensRoutes(router)
snippetsRoutes(router)
cronRoutes(router)
usersRoutes(router)
navigationRoutes(router)
redirectsRoutes(router)
exportRoutes(router)
opsRoutes(router)
// The public content API. Versioned because its consumers are outside this
// repository, and read-only because the admin API already owns the writes.
v1Routes(router)
contentModelRoutes(router)
// Features, after core and in the order src/features.ts lists them. The theme
// is listed last: its /:slug and /:base/:slug would catch anything after it.
mountFeatureRoutes(router)
router.applyTo(app)

// Serverless platforms invoke a handler per request and give you no port to
// bind, so the listener has to be conditional. `api/index.ts` imports this
// module for its configured app and drives it directly; see that file for how.
//
// Everywhere else — local development, any persistent host — this is the entry
// point and listening is exactly right.
if (!process.env.VERCEL) {
  const port = process.env.PORT || 3001

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`)
  })
}

export default app
