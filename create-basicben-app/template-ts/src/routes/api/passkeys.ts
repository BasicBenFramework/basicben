import { PasskeyController } from '../../controllers/PasskeyController'
import { auth } from '../../middleware/auth'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // Public: the second step of a login, so there is no session yet. It takes
  // the challenge issued after a correct password, so it cannot be used to
  // discover whether an account has passkeys.
  router.post('/api/auth/passkey/options', PasskeyController.authenticateOptions)

  // Managing your own passkeys.
  router.get('/api/auth/passkeys', auth, PasskeyController.list)
  router.post('/api/auth/passkeys/options', auth, PasskeyController.registerOptions)
  router.post('/api/auth/passkeys/verify', auth, PasskeyController.registerVerify)
  router.delete('/api/auth/passkeys/:id', auth, PasskeyController.remove)
}
