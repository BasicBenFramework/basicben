import { ProfileController } from '../../controllers/ProfileController'
import { auth } from '../../middleware/auth'
import { accountChangeLimit } from '../../middleware/rate-limits'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  router.get('/api/profile', auth, ProfileController.show)
  router.put('/api/profile', auth, accountChangeLimit, ProfileController.update)
  router.put('/api/profile/password', auth, accountChangeLimit, ProfileController.changePassword)
}
