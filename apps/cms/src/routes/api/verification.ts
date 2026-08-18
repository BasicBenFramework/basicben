import { EmailVerificationController } from '../../controllers/EmailVerificationController'
import { auth } from '../../middleware/auth'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // Public: this is the target of the emailed link, so it cannot require a
  // session — the whole point is that it may be opened in another browser.
  router.get('/api/auth/verify/:token', EmailVerificationController.verify)

  // Authenticated. Deliberately not gated on a capability: an unverified user
  // holds almost none, and these two are how they stop being unverified.
  router.get('/api/auth/verify', auth, EmailVerificationController.status)
  router.post('/api/auth/verify/resend', auth, EmailVerificationController.resend)
}
