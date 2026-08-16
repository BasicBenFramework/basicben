import { MediaController } from '../../controllers/MediaController'
import { auth } from '../../middleware/auth'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // All media routes require authentication
  router.get('/api/media', auth, MediaController.index)
  router.get('/api/media/stats', auth, MediaController.stats)
  router.get('/api/media/:id', auth, MediaController.show)
  // Uploads are two steps: sign, then PUT straight to storage, then confirm.
  // The bytes never pass through this server.
  router.post('/api/media/sign', auth, requireCapability('media.upload'), MediaController.sign)
  router.post('/api/media/confirm', auth, requireCapability('media.upload'), MediaController.confirm)
  router.put('/api/media/:id', auth, requireCapability('media.upload'), MediaController.update)
  router.delete('/api/media/:id', auth, requireCapability('media.delete'), MediaController.destroy)
}
