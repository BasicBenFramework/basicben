import { PublicApiController } from '../../controllers/PublicApiController'
import { SettingsController } from '../../controllers/SettingsController'
import { NavigationController } from '../../controllers/NavigationController'
import { RedirectController } from '../../controllers/RedirectController'
import { requireScope } from '../../middleware/api-auth'
import { SCOPES } from '@basicbenframework/core/auth/api-tokens'
import { cacheable } from '../../middleware/cache'
import { publicApiLimit } from '../../middleware/rate-limits'
import { publishDueOpportunistically } from '../../helpers/publish-due'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
}

/**
 * The public content API.
 *
 * Every route needs `content:read` (or `media:read`), satisfied by an API token
 * or a signed-in session — or by nothing at all, if the site has turned on
 * public reads in settings. See `middleware/api-auth.ts`.
 */
export default (router: Router) => {
  const content = requireScope(SCOPES.CONTENT_READ)
  const media = requireScope(SCOPES.MEDIA_READ)

  // Post reads also announce any scheduled post whose time has come, at most
  // once a minute — see helpers/publish-due.ts.
  router.get('/api/v1/posts', publicApiLimit, content, publishDueOpportunistically, cacheable, PublicApiController.posts)
  router.get('/api/v1/posts/:slug', publicApiLimit, content, publishDueOpportunistically, cacheable, PublicApiController.post)

  router.get('/api/v1/pages', publicApiLimit, content, cacheable, PublicApiController.pages)
  router.get('/api/v1/pages/:slug', publicApiLimit, content, cacheable, PublicApiController.page)

  // Author archives: the profile, and `/api/v1/posts?author=` for their work.
  router.get('/api/v1/authors', publicApiLimit, content, cacheable, PublicApiController.authors)
  router.get('/api/v1/authors/:slug', publicApiLimit, content, cacheable, PublicApiController.author)

  router.get('/api/v1/categories', publicApiLimit, content, cacheable, PublicApiController.categories)
  router.get('/api/v1/tags', publicApiLimit, content, cacheable, PublicApiController.tags)

  router.get('/api/v1/media/:id', publicApiLimit, media, cacheable, PublicApiController.media)

  // Site identity, menus and redirects: what a headless front end needs to
  // render its chrome and answer old URLs. Same credential rule as content.
  // (Not on PublicApiController, so the generated reference — which documents
  // PublicContent shapes only — is unaffected until it learns these shapes.)
  router.get('/api/v1/site', publicApiLimit, content, cacheable, SettingsController.publicSite)
  router.get('/api/v1/navigation', publicApiLimit, content, cacheable, NavigationController.publicIndex)
  router.get('/api/v1/redirects', publicApiLimit, content, cacheable, RedirectController.publicIndex)
}
