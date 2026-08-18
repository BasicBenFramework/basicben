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

  // The JWT is stateless, so this cannot revoke anything — it exists so that a
  // sign-out is observable to a listener (a denylist, an audit log).
  router.post('/api/auth/logout', AuthController.logout)
}
