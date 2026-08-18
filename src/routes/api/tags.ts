import { TagController } from '../../controllers/TagController'
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
  router.get('/api/tags', TagController.index)
  router.get('/api/tags/slug/:slug', TagController.showBySlug)
  router.get('/api/tags/:id', TagController.show)

  // Admin routes (authenticated)
  router.post('/api/tags', auth, requireCapability('tag.manage'), TagController.store)
  router.put('/api/tags/:id', auth, requireCapability('tag.manage'), TagController.update)
  router.delete('/api/tags/:id', auth, requireCapability('tag.manage'), TagController.destroy)
}
