import { TwoFactorController } from '../../controllers/TwoFactorController'
import { auth } from '../../middleware/auth'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // Public: this is the second step of a login, so the caller has no session
  // yet — that is the entire point of the challenge.
  router.post('/api/auth/2fa/verify', TwoFactorController.verify)

  // Managing your own factors. Not gated on a capability: these are account
  // security settings, which every signed-in user needs regardless of role.
  router.get('/api/auth/2fa', auth, TwoFactorController.status)
  router.post('/api/auth/2fa/totp/setup', auth, TwoFactorController.setupTotp)
  router.post('/api/auth/2fa/totp/confirm', auth, TwoFactorController.confirmTotp)
  router.delete('/api/auth/2fa/totp', auth, TwoFactorController.disableTotp)
  router.post('/api/auth/2fa/recovery/rotate', auth, TwoFactorController.rotateRecoveryCodes)
}
