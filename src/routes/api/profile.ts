import { ProfileController } from '../../controllers/ProfileController.ts'
import { auth } from '../../middleware/auth.ts'
import { accountChangeLimit } from '../../middleware/rate-limits.ts'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  router.get('/api/profile', auth, ProfileController.show)
  router.put('/api/profile', auth, accountChangeLimit, ProfileController.update)
  router.put('/api/profile/password', auth, accountChangeLimit, ProfileController.changePassword)
}
