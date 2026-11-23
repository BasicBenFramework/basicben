import { ExportController } from '../../controllers/ExportController'
import { auth } from '../../middleware/auth'
import { requireSession } from '../../middleware/api-auth'
import { requireRole, ROLES } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
}

export default (router: Router) => {
  // Admins only, by role rather than capability: an export carries every
  // user's address and every draft, which is more than any one capability
  // grants. A signed-in session, never an API token — a leaked token should
  // not be a way to download the whole site.
  router.get('/api/export', auth, requireSession, requireRole(ROLES.ADMIN), ExportController.download)
}
