import { HealthController } from '../../controllers/HealthController'
import { auth } from '../../middleware/auth'
import { requireSession } from '../../middleware/api-auth'
import { healthActionLimit } from '../../middleware/rate-limits'
import { requireRole, ROLES } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
}

/**
 * Operations: site health and the maintenance cron.
 */
export default (router: Router) => {
  // Admins only, by role, and a signed-in session rather than an API token —
  // the same rule as the export. The page describes how the deployment is
  // secured, which is a map for whoever holds a leaked token.
  const admin = [auth, requireSession, requireRole(ROLES.ADMIN)]

  router.get('/api/admin/health', ...admin, HealthController.index)
  router.post('/api/admin/health/storage-probe', ...admin, healthActionLimit, HealthController.storageProbe)
  router.post('/api/admin/health/test-email', ...admin, healthActionLimit, HealthController.testEmail)

  // For a platform scheduler; checks CRON_SECRET itself.
  router.get('/api/cron/maintenance', HealthController.maintenance)
}
