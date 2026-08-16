import { SettingsController } from '../../controllers/SettingsController'
import { auth } from '../../middleware/auth'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // Public site info
  router.get('/api/site', SettingsController.getSiteInfo)

  // Admin routes (authenticated)
  router.get('/api/settings', auth, requireCapability('settings.manage'), SettingsController.index)
  router.get('/api/settings/group/:group', auth, requireCapability('settings.manage'), SettingsController.byGroup)
  router.get('/api/settings/:key', auth, requireCapability('settings.manage'), SettingsController.get)
  router.put('/api/settings', auth, requireCapability('settings.manage'), SettingsController.update)
  router.put('/api/settings/:key', auth, requireCapability('settings.manage'), SettingsController.set)
  router.delete('/api/settings/:key', auth, requireCapability('settings.manage'), SettingsController.delete)
  router.put('/api/site', auth, requireCapability('settings.manage'), SettingsController.updateSiteInfo)
}
