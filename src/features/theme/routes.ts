import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { ThemeController, themeEnabled } from './ThemeController'
import { OEmbedController } from './OEmbedController'
import { publicApiLimit } from '../../middleware/rate-limits'
import { publishDueOpportunistically } from '../../helpers/publish-due'

import type { Router } from '../../host'

/**
 * The reference public site (server-rendered theme) and the oEmbed provider.
 *
 * This feature goes **last** in src/features.ts, so these routes are mounted
 * after core's and every other feature's. The router answers
 * with the first route that matches, and `/:slug` and `/:base/:slug` match a
 * great deal: registered last, `/api/...`, `/feed.xml`, `/sitemap.xml` and
 * every other real route are matched before them. Static files are served by
 * middleware that runs before any route, so assets are never shadowed either.
 * Paths the SPA owns (`/admin`, `/login`, …) are handed the app shell by the
 * controller, theme on or off.
 *
 * With DISABLE_PUBLIC_SITE nothing is registered, for the same reason the
 * feeds are not: there is no public site to render or to embed.
 */
export function themeRoutes(router: Router): void {
  if (process.env.DISABLE_PUBLIC_SITE === 'true') return

  // oEmbed answers whether or not the theme renders pages: a headless front
  // end serving the same paths (SITE_URL) is still "this site".
  router.get('/oembed', publicApiLimit, OEmbedController.show)

  // A scheduled post whose time has come is announced before the first page
  // that could show it, as the content API does on its post reads.
  const live = publishDueOpportunistically

  router.get('/page/:page', live, ThemeController.homePage)
  router.get('/blog/:slug', live, ThemeController.post)
  router.get('/category/:slug', live, ThemeController.category)
  router.get('/tag/:slug', live, ThemeController.tag)
  router.get('/author/:slug', live, ThemeController.author)
  router.get('/taxonomy/:key/:slug', live, ThemeController.term)
  router.get('/:base/:slug', live, ThemeController.typed)
  router.get('/:slug', live, ThemeController.single)

  // `/` cannot be a route. The static middleware runs before routing and
  // answers `/` with the SPA's index.html from the build directory, so a
  // `router.get('/')` would never be reached. `request.before` runs ahead of
  // the static middleware, and a listener that returns `handled: true` owns
  // the response — so the home page is rendered there, and only when the
  // theme is on; otherwise the request carries on to the SPA as it always has.
  hooks.on(HOOKS.REQUEST_BEFORE, async (context: { req: any; res: any; handled?: boolean }) => {
    const { req, res } = context
    if (context.handled || req.method !== 'GET' || req.path !== '/') return context
    if (!(await themeEnabled())) return context

    await new Promise<void>((done) => publishDueOpportunistically(req, res, done))
    await ThemeController.home(req, res)
    return { ...context, handled: true }
  })
}
