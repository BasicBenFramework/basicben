import { CategoryController } from '../../controllers/CategoryController'
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
  router.get('/api/categories', CategoryController.index)
  router.get('/api/categories/tree', CategoryController.tree)
  router.get('/api/categories/slug/:slug', CategoryController.showBySlug)
  router.get('/api/categories/:id', CategoryController.show)

  // Admin routes (authenticated)
  router.post('/api/categories', auth, requireCapability('category.manage'), CategoryController.store)
  router.put('/api/categories/:id', auth, requireCapability('category.manage'), CategoryController.update)
  router.delete('/api/categories/:id', auth, requireCapability('category.manage'), CategoryController.destroy)
}
