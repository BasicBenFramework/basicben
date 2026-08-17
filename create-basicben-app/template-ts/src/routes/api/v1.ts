import { PublicApiController } from '../../controllers/PublicApiController'
import { requireScope } from '../../middleware/api-auth'
import { SCOPES } from '@basicbenframework/core/auth/api-tokens'
import { cacheable } from '../../middleware/cache'

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

  router.get('/api/v1/posts', content, cacheable, PublicApiController.posts)
  router.get('/api/v1/posts/:slug', content, cacheable, PublicApiController.post)

  router.get('/api/v1/pages', content, cacheable, PublicApiController.pages)
  router.get('/api/v1/pages/:slug', content, cacheable, PublicApiController.page)

  router.get('/api/v1/categories', content, cacheable, PublicApiController.categories)
  router.get('/api/v1/tags', content, cacheable, PublicApiController.tags)

  router.get('/api/v1/media/:id', media, cacheable, PublicApiController.media)
}
