import { requireCapability } from '@basicbenframework/core/auth/permissions'
import { auth } from '../../middleware/auth.ts'
import { mysendboxWebhook } from './webhook.ts'
import { MySendboxController } from './controller.ts'
import type { Router } from '../../host'

/**
 * The webhook is public and verified by its signature. The admin routes are
 * the members list's own rule: who may manage accounts may copy them.
 */
export function mysendboxRoutes(router: Router): void {
  router.post('/api/webhooks/mysendbox', mysendboxWebhook)

  const manage = [auth, requireCapability('user.manage')]
  router.get('/api/mysendbox/status', ...manage, MySendboxController.status)
  router.post('/api/mysendbox/backfill', ...manage, MySendboxController.backfill)
}
