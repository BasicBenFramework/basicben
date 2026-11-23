import { MediaController } from '../../controllers/MediaController'
import { auth } from '../../middleware/auth'
import { authOrToken } from '../../middleware/api-auth'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

// The Admin API for media: a session, or an API token holding media:write,
// acting as its owner — so `media.upload` below is the owner's capability, and
// a contributor's token can no more upload than the contributor can.
const mediaWrite = authOrToken('media:write')

export default (router: Router) => {
  // Browsing the library is for the people who can add to it. A subscriber
  // has a session and no business listing every upload and who made it.
  router.get('/api/media', mediaWrite, requireCapability('media.upload'), MediaController.index)
  router.get('/api/media/stats', auth, requireCapability('media.upload'), MediaController.stats)
  router.get('/api/media/:id', mediaWrite, requireCapability('media.upload'), MediaController.show)
  // Uploads are two steps: sign, then PUT straight to storage, then confirm.
  // The bytes never pass through this server.
  router.post('/api/media/sign', mediaWrite, requireCapability('media.upload'), MediaController.sign)
  router.post('/api/media/confirm', mediaWrite, requireCapability('media.upload'), MediaController.confirm)
  // Ownership is checked in the controller against the row, which is what
  // lets `media.delete.own` mean something.
  router.put('/api/media/:id', mediaWrite, requireCapability('media.upload'), MediaController.update)
  // Deleting a file breaks every post that shows it, and there is no trash to
  // get it back from, so it stays with a signed-in person.
  router.delete('/api/media/:id', auth, MediaController.destroy)
}
