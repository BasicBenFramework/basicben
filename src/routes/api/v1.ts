import { PublicApiController } from '../../controllers/PublicApiController'
import { requireScope } from '../../middleware/api-auth'
import { SCOPES } from '@basicbenframework/core/auth/api-tokens'
import { cacheable } from '../../middleware/cache'
import { publicApiLimit } from '../../middleware/rate-limits'

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

  router.get('/api/v1/posts', publicApiLimit, content, cacheable, PublicApiController.posts)
  router.get('/api/v1/posts/:slug', publicApiLimit, content, cacheable, PublicApiController.post)

  router.get('/api/v1/pages', publicApiLimit, content, cacheable, PublicApiController.pages)
  router.get('/api/v1/pages/:slug', publicApiLimit, content, cacheable, PublicApiController.page)

  // Author archives: the profile, and `/api/v1/posts?author=` for their work.
  router.get('/api/v1/authors', publicApiLimit, content, cacheable, PublicApiController.authors)
  router.get('/api/v1/authors/:slug', publicApiLimit, content, cacheable, PublicApiController.author)

  router.get('/api/v1/categories', publicApiLimit, content, cacheable, PublicApiController.categories)
  router.get('/api/v1/tags', publicApiLimit, content, cacheable, PublicApiController.tags)

  router.get('/api/v1/media/:id', publicApiLimit, media, cacheable, PublicApiController.media)
}
