import { PageController } from '../../controllers/PageController.ts'
import { auth } from '../../middleware/auth.ts'
import { authOrToken } from '../../middleware/api-auth.ts'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // Public routes
  router.get('/api/pages/published', PageController.published)
  router.get('/api/pages/slug/:slug', PageController.showPublishedBySlug)

  // Admin routes (authenticated)
  router.get('/api/pages', auth, requireCapability('page.edit'), PageController.index)
  router.get('/api/pages/tree', auth, requireCapability('page.edit'), PageController.tree)
  router.get('/api/pages/:id', auth, requireCapability('page.edit'), PageController.show)
  // Creating and editing take an API token with content:write, as posts do
  // (docs/admin-api.md). Delete stays session-only: a page delete is
  // permanent, and no token may destroy content outright.
  router.post('/api/pages', authOrToken('content:write'), requireCapability('page.create'), PageController.store)
  // Before /:id, which would otherwise match `reorder` as an id.
  router.put('/api/pages/reorder', auth, requireCapability('page.edit'), PageController.reorder)
  router.put('/api/pages/:id', authOrToken('content:write'), requireCapability('page.edit'), PageController.update)
  router.delete('/api/pages/:id', auth, requireCapability('page.delete'), PageController.destroy)
}
