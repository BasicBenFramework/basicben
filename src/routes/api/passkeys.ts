import { PasskeyController } from '../../controllers/PasskeyController.ts'
import { auth } from '../../middleware/auth.ts'
import { passkeySignInLimit } from '../../middleware/rate-limits.ts'

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

  // Public: a passkey instead of a password. The options name no account, so
  // they reveal nothing; the session comes only from a verified signature.
  router.post('/api/auth/passkey/sign-in/options', passkeySignInLimit, PasskeyController.signInOptions)
  router.post('/api/auth/passkey/sign-in', passkeySignInLimit, PasskeyController.signIn)

  // Managing your own passkeys.
  router.get('/api/auth/passkeys', auth, PasskeyController.list)
  router.post('/api/auth/passkeys/options', auth, PasskeyController.registerOptions)
  router.post('/api/auth/passkeys/verify', auth, PasskeyController.registerVerify)
  router.delete('/api/auth/passkeys/:id', auth, PasskeyController.remove)
}
