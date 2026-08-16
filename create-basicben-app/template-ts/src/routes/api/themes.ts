import { ThemeController } from '../../controllers/ThemeController'
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
  router.get('/api/themes/active', ThemeController.active)
  router.get('/api/themes/css', ThemeController.css)
  router.get('/api/themes/css/:slug', ThemeController.css)

  // Admin routes (authenticated)
  router.get('/api/themes', auth, requireCapability('theme.manage'), ThemeController.index)
  router.get('/api/themes/:slug', auth, requireCapability('theme.manage'), ThemeController.show)
  router.post('/api/themes/activate', auth, requireCapability('theme.manage'), ThemeController.activate)
  router.get('/api/themes/:slug/settings', auth, requireCapability('theme.manage'), ThemeController.getSettings)
  router.put('/api/themes/:slug/settings', auth, requireCapability('theme.manage'), ThemeController.updateSettings)
  router.delete('/api/themes/:slug/settings', auth, requireCapability('theme.manage'), ThemeController.resetSettings)
}
