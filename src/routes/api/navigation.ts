import { NavigationController } from '../../controllers/NavigationController.ts'
import { auth } from '../../middleware/auth.ts'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

/**
 * Admin management of navigation menus. The public read is
 * `/api/v1/navigation`, in v1.ts.
 */
export default (router: Router) => {
  router.get('/api/navigation/menus', auth, requireCapability('settings.manage'), NavigationController.index)
  router.post('/api/navigation/menus', auth, requireCapability('settings.manage'), NavigationController.storeMenu)
  router.put('/api/navigation/menus/:id', auth, requireCapability('settings.manage'), NavigationController.updateMenu)
  router.delete('/api/navigation/menus/:id', auth, requireCapability('settings.manage'), NavigationController.destroyMenu)

  router.post('/api/navigation/menus/:id/items', auth, requireCapability('settings.manage'), NavigationController.storeItem)
  router.put('/api/navigation/menus/:id/reorder', auth, requireCapability('settings.manage'), NavigationController.reorder)

  router.put('/api/navigation/items/:id', auth, requireCapability('settings.manage'), NavigationController.updateItem)
  router.delete('/api/navigation/items/:id', auth, requireCapability('settings.manage'), NavigationController.destroyItem)
}
