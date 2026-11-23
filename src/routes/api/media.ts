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
  // Browsing the library is for the people who can add to it. A subscriber
  // has a session and no business listing every upload and who made it.
  router.get('/api/media', auth, requireCapability('media.upload'), MediaController.index)
  router.get('/api/media/stats', auth, requireCapability('media.upload'), MediaController.stats)
  router.get('/api/media/:id', auth, requireCapability('media.upload'), MediaController.show)
  // Uploads are two steps: sign, then PUT straight to storage, then confirm.
  // The bytes never pass through this server.
  router.post('/api/media/sign', auth, requireCapability('media.upload'), MediaController.sign)
  router.post('/api/media/confirm', auth, requireCapability('media.upload'), MediaController.confirm)
  // Ownership is checked in the controller against the row, which is what
  // lets `media.delete.own` mean something.
  router.put('/api/media/:id', auth, requireCapability('media.upload'), MediaController.update)
  router.delete('/api/media/:id', auth, MediaController.destroy)
}
