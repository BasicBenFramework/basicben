import { TokenController } from '../../controllers/TokenController'
import { auth } from '../../middleware/auth'
import { requireSession } from '../../middleware/api-auth'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // Managing tokens requires a logged-in session, never a token — otherwise a
  // leaked read-only token could mint itself a write-scoped one and scopes
  // would mean nothing.
  //
  // `auth` is what enforces that today; it refuses an API token outright. The
  // second latch is here for the day someone widens these routes to accept one,
  // which is exactly the change that would open the escalation quietly.
  router.get('/api/tokens', auth, requireSession, TokenController.index)
  router.post('/api/tokens', auth, requireSession, TokenController.store)
  router.delete('/api/tokens/:id', auth, requireSession, TokenController.destroy)
}
