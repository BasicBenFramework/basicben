import { UpdatesController } from '../../controllers/UpdatesController'
import { auth } from '../../middleware/auth'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // All update routes require authentication

  // Check for updates
  router.get('/api/updates/check', auth, requireCapability('update.manage'), UpdatesController.check)
  router.get('/api/updates/core', auth, requireCapability('update.manage'), UpdatesController.checkCore)
  router.get('/api/updates/plugins', auth, requireCapability('update.manage'), UpdatesController.checkPlugins)

  // Apply updates
  router.post('/api/updates/core', auth, requireCapability('update.manage'), UpdatesController.updateCore)
  router.post('/api/updates/plugins/:slug', auth, requireCapability('update.manage'), UpdatesController.updatePlugin)

  // Changelog
  router.get('/api/updates/changelog/:version', auth, requireCapability('update.manage'), UpdatesController.changelog)

  // Registry browsing
  router.get('/api/registry/plugins', auth, requireCapability('update.manage'), UpdatesController.browsePlugins)

  // Install from registry
  router.post('/api/registry/plugins/install', auth, requireCapability('update.manage'), UpdatesController.installPlugin)

  // Backups
  router.get('/api/backups', auth, requireCapability('update.manage'), UpdatesController.listBackups)
  router.post('/api/backups', auth, requireCapability('update.manage'), UpdatesController.createBackup)
  router.post('/api/backups/:id/restore', auth, requireCapability('update.manage'), UpdatesController.restoreBackup)
}
