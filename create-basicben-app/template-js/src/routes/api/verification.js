import { EmailVerificationController } from '../../controllers/EmailVerificationController.js'
import { auth } from '../../middleware/auth.js'

export default (router) => {
  // Public: the target of the emailed link, which may be opened in a browser
  // that has never signed in.
  router.get('/api/auth/verify/:token', EmailVerificationController.verify)

  // Authenticated, but deliberately not gated on a capability — an unverified
  // user holds almost none, and these are how they stop being unverified.
  router.get('/api/auth/verify', auth, EmailVerificationController.status)
  router.post('/api/auth/verify/resend', auth, EmailVerificationController.resend)
}
