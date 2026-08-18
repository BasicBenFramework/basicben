import { PageController } from '../../controllers/PageController'
import { auth } from '../../middleware/auth'
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
  router.post('/api/pages', auth, requireCapability('page.create'), PageController.store)
  router.put('/api/pages/:id', auth, requireCapability('page.edit'), PageController.update)
  router.delete('/api/pages/:id', auth, requireCapability('page.delete'), PageController.destroy)
  router.put('/api/pages/reorder', auth, requireCapability('page.edit'), PageController.reorder)
}
