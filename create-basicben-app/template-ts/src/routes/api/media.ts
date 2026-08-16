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
  router.post('/api/media/upload', auth, requireCapability('media.upload'), MediaController.upload)
  router.put('/api/media/:id', auth, requireCapability('media.upload'), MediaController.update)
  router.delete('/api/media/:id', auth, requireCapability('media.delete'), MediaController.destroy)
}
