import { PluginController } from '../../controllers/PluginController'
import { auth } from '../../middleware/auth'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // All plugin management routes require authentication
  router.get('/api/plugins', auth, requireCapability('plugin.manage'), PluginController.index)
  router.get('/api/plugins/:name', auth, requireCapability('plugin.manage'), PluginController.show)
  router.post('/api/plugins/activate', auth, requireCapability('plugin.manage'), PluginController.activate)
  router.post('/api/plugins/deactivate', auth, requireCapability('plugin.manage'), PluginController.deactivate)
  router.get('/api/plugins/:name/settings', auth, requireCapability('plugin.manage'), PluginController.getSettings)
  router.put('/api/plugins/:name/settings', auth, requireCapability('plugin.manage'), PluginController.updateSettings)
}
