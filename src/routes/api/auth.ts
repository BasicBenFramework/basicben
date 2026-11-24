import { auth } from '../../middleware/auth.ts'
import { AuthController } from '../../controllers/AuthController.ts'
import { loginByAddress, loginByAccount, registerLimit } from '../../middleware/rate-limits.ts'
import { PasswordResetController } from '../../controllers/PasswordResetController.ts'
import { passwordResetLimit, tokenRedeemLimit } from '../../middleware/rate-limits.ts'

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

  // Through `auth`, so a revoked or disabled session is refused here too —
  // this is what the client asks on load to decide whether it is signed in.
  router.get('/api/user', auth, AuthController.user)

  // Ends every session the account has: tokens carry a version, and this
  // bumps it.
  router.post('/api/auth/logout', auth, AuthController.logout)

  // Forgotten passwords. The request is limited by address here and by mailbox
  // inside the controller — silently, so the answer never depends on whether
  // the account exists. Both stay registered with DISABLE_REGISTRATION and
  // without a public site: they are how an existing account gets back in.
  router.post('/api/auth/forgot-password', passwordResetLimit, PasswordResetController.request)
  router.post('/api/auth/reset-password', tokenRedeemLimit, PasswordResetController.reset)
}
