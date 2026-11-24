/**
 * Server entry point
 *
 * For TypeScript projects, routes must be explicitly imported
 * so Vite can bundle them during SSR build.
 */

import { createServer, createRouter, loadConfig } from '@basicbenframework/core/server'

// Registers the application's hook listeners. Imported for its side effects —
// the listeners have to be on the registry before the server starts.
import '../hooks.ts'
// Core's scheduled work, in the registry features add to.
import '../host/core-tasks.ts'
import { registerFeatures, mountFeatureRoutes } from '../host/index.ts'
import features from '../features.ts'
import { enabledFeatureNames } from '../host/enabled.ts'

// Import routes explicitly for Vite bundling
import authRoutes from '../routes/api/auth.ts'
import verificationRoutes from '../routes/api/verification.ts'
import twoFactorRoutes from '../routes/api/two-factor.ts'
import passkeyRoutes from '../routes/api/passkeys.ts'
import postsRoutes from '../routes/api/posts.ts'
import profileRoutes from '../routes/api/profile.ts'
import authorsRoutes from '../routes/api/authors.ts'
import categoriesRoutes from '../routes/api/categories.ts'
import tagsRoutes from '../routes/api/tags.ts'
import pagesRoutes from '../routes/api/pages.ts'
import commentsRoutes from '../routes/api/comments.ts'
import mediaRoutes from '../routes/api/media.ts'
import settingsRoutes from '../routes/api/settings.ts'
import feedRoutes from '../routes/api/feed.ts'
import adminRoutes from '../routes/api/admin.ts'
import tokensRoutes from '../routes/api/tokens.ts'
import usersRoutes from '../routes/api/users.ts'
import v1Routes from '../routes/api/v1.ts'
import cronRoutes from '../routes/api/cron.ts'
import navigationRoutes from '../routes/api/navigation.ts'
import redirectsRoutes from '../routes/api/redirects.ts'
import snippetsRoutes from '../routes/api/snippets.ts'
import exportRoutes from '../routes/api/export.ts'
import opsRoutes from '../routes/api/ops.ts'
import contentModelRoutes from '../routes/api/content-model.ts'

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

// The features the site lists in basicben.config.js register their settings,
// tasks and routes before anything is mounted, so a settings save or a health
// check sees all of them. Features left off are imported but never registered,
// and do nothing.
const config = await loadConfig()
await registerFeatures(enabledFeatureNames(config.features).map((name) => features[name]))

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
// Features, after core and in the order the site lists them. The theme must
// be last (enabledFeatureNames checks): its /:slug would catch anything after.
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
