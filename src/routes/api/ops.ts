import { HealthController } from '../../controllers/HealthController'
import { AnalyticsController } from '../../controllers/AnalyticsController'
import { auth } from '../../middleware/auth'
import { requireSession } from '../../middleware/api-auth'
import { analyticsHitLimit, healthActionLimit } from '../../middleware/rate-limits'
import { requireRole, requireCapability, ROLES } from '@basicbenframework/core/auth/permissions'

interface Router {
  get: (path: string, ...handlers: Function[]) => void
  post: (path: string, ...handlers: Function[]) => void
}

/**
 * Operations: site health, analytics, and the maintenance cron.
 */
export default (router: Router) => {
  // Admins only, by role, and a signed-in session rather than an API token —
  // the same rule as the export. The page describes how the deployment is
  // secured, which is a map for whoever holds a leaked token.
  const admin = [auth, requireSession, requireRole(ROLES.ADMIN)]

  router.get('/api/admin/health', ...admin, HealthController.index)
  router.post('/api/admin/health/storage-probe', ...admin, healthActionLimit, HealthController.storageProbe)
  router.post('/api/admin/health/test-email', ...admin, healthActionLimit, HealthController.testEmail)

  // Counts, not people, so editors may read them too. Changing the analytics
  // settings goes through PUT /api/settings, which is settings.manage.
  router.get('/api/admin/analytics', auth, requireCapability('post.edit'), AnalyticsController.summary)

  // Public by design: the caller is a reader's browser on the front end,
  // which has no credential. Rate-limited on a hash of the address. Under
  // /api/v1 because it is part of the surface a headless front end talks to.
  router.post('/api/v1/analytics/hit', analyticsHitLimit, AnalyticsController.hit)

  // For a platform scheduler; checks CRON_SECRET itself.
  router.get('/api/cron/maintenance', HealthController.maintenance)
}
