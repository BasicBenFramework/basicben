import { AuthController } from '../../controllers/AuthController'
import { loginByAddress, loginByAccount, registerLimit } from '../../middleware/rate-limits'

interface Router {
  post: (path: string, ...handlers: Function[]) => void
  get: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  router.post('/api/auth/register', registerLimit, AuthController.register)

  // Both limits, because they stop different attacks: by address catches one
  // attacker working through many accounts, by account catches many addresses
  // working on one — which is what credential stuffing looks like.
  router.post('/api/auth/login', loginByAddress, loginByAccount, AuthController.login)

  router.get('/api/user', AuthController.user)
}
