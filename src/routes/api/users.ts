import { UserController, InvitationController } from '../../controllers/UserController'
import { auth } from '../../middleware/auth'
import { invitationLimit, tokenRedeemLimit } from '../../middleware/rate-limits'
import { requireCapability } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
  put: (path: string, ...handlers: Function[]) => void
  delete: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // Every account-management route is `auth` then `user.manage`, and only an
  // admin holds that. `auth` reads the role from the database on each request,
  // so an admin who has just been demoted loses these routes on their next
  // click rather than when their token expires.
  const manage = [auth, requireCapability('user.manage')]

  router.get('/api/users', ...manage, UserController.index)
  // Before /api/users/:id so "invite" is never read as an id.
  router.post('/api/users/invite', ...manage, invitationLimit, InvitationController.store)
  router.put('/api/users/:id', ...manage, UserController.update)
  router.post('/api/users/:id/disable', ...manage, UserController.disable)
  router.post('/api/users/:id/enable', ...manage, UserController.enable)
  router.delete('/api/users/:id', ...manage, UserController.destroy)

  router.get('/api/invitations', ...manage, InvitationController.index)
  router.delete('/api/invitations/:id', ...manage, InvitationController.destroy)

  // Public: the person holding the link has no account yet — the link is the
  // credential. Registered whatever DISABLE_REGISTRATION says, because on a
  // closed site an invitation is how anyone new gets in.
  router.get('/api/invitations/:token', InvitationController.show)
  router.post('/api/invitations/:token/accept', tokenRedeemLimit, InvitationController.accept)
}
