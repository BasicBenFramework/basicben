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
  router.get('/api/updates/themes', auth, requireCapability('update.manage'), UpdatesController.checkThemes)

  // Apply updates
  router.post('/api/updates/core', auth, requireCapability('update.manage'), UpdatesController.updateCore)
  router.post('/api/updates/plugins/:slug', auth, requireCapability('update.manage'), UpdatesController.updatePlugin)
  router.post('/api/updates/themes/:slug', auth, requireCapability('update.manage'), UpdatesController.updateTheme)

  // Changelog
  router.get('/api/updates/changelog/:version', auth, requireCapability('update.manage'), UpdatesController.changelog)

  // Registry browsing
  router.get('/api/registry/plugins', auth, requireCapability('update.manage'), UpdatesController.browsePlugins)
  router.get('/api/registry/themes', auth, requireCapability('update.manage'), UpdatesController.browseThemes)

  // Install from registry
  router.post('/api/registry/plugins/install', auth, requireCapability('update.manage'), UpdatesController.installPlugin)
  router.post('/api/registry/themes/install', auth, requireCapability('update.manage'), UpdatesController.installTheme)

  // Backups
  router.get('/api/backups', auth, requireCapability('update.manage'), UpdatesController.listBackups)
  router.post('/api/backups', auth, requireCapability('update.manage'), UpdatesController.createBackup)
  router.post('/api/backups/:id/restore', auth, requireCapability('update.manage'), UpdatesController.restoreBackup)
}
