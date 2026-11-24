/**
 * Cookieless page-view analytics, as a feature.
 *
 * Remove this folder and its lines in src/features.ts, src/client/features.ts
 * and src/features.manifest.ts, and the core runs without it. Its tables
 * (migration 036) stay, empty and harmless. How the counting works and what
 * it never stores: README.md.
 */

import { createHash } from 'node:crypto'
import { rateLimit } from '@basicbenframework/core/rate-limit'
import { requireCapability } from '@basicbenframework/core/auth/permissions'
import { auth } from '../../middleware/auth.ts'
import { store, clientIp } from '../../middleware/rate-limits.ts'
import { checks } from '../../helpers/site-settings.ts'
import { check } from '../../helpers/health.ts'
import type { Feature } from '../../host/index.ts'
import type { Request } from '../../types/index.ts'
import { AnalyticsController } from './controller.ts'
import { purge } from './model.ts'

/**
 * Page-view hits from anyone (`POST /api/v1/analytics/hit`).
 *
 * The analytics promise is that no address is stored, and the limiter's own
 * table would otherwise be the exception: its key is normally the address in
 * the clear. So this one keys on a hash of it, with APP_KEY mixed in so the
 * key cannot be reversed by hashing every IPv4 address. The row still lives
 * only as long as the limiter's window, like every other.
 *
 * Generous — a reader opening tabs, or an office behind one NAT, is a lot of
 * page views a minute — because its job is bounding garbage, not policing
 * readers.
 */
export const analyticsHitLimit = rateLimit({
  limit: 120,
  window: '1m',
  blockFor: '5m',
  store,
  key: (req: Request) => {
    const ip = clientIp(req)
    if (!ip) return null
    const hashed = createHash('sha256').update(`${process.env.APP_KEY ?? ''}\0analytics\0${ip}`).digest('hex').slice(0, 32)
    return `analytics:${hashed}`
  },
  message: 'Too many requests.'
})

const analytics: Feature = {
  name: 'analytics',

  register(host) {
    host.settings.define({
      // Unset means on: the ingest endpoint does nothing until a front end
      // calls it anyway.
      analytics_enabled: { group: 'analytics', check: checks.flag },
      // How long a visitor hash may live, in hours. Hashes are deleted when
      // their UTC day ends regardless (the day's salt goes with it), so more
      // than 24 buys nothing; less trades accuracy for holding even
      // pseudonymous data for a shorter time.
      analytics_dedup_hours: { group: 'analytics', check: checks.integer(1, 24) },
      // Days of daily counts to keep. 0 keeps them indefinitely: they are
      // counts, not personal data.
      analytics_retention_days: { group: 'analytics', check: checks.integer(0, 3650) }
    })

    host.routes((router) => {
      // Counts, not people, so editors may read them too. Changing the
      // settings goes through PUT /api/settings, which is settings.manage.
      router.get('/api/admin/analytics', auth, requireCapability('post.edit'), AnalyticsController.summary)

      // Public by design: the caller is a reader's browser, which has no
      // credential. Under /api/v1 because it is part of the surface a headless
      // front end talks to.
      router.post('/api/v1/analytics/hit', analyticsHitLimit, AnalyticsController.hit)
    })

    // Hashes must not outlive their window on a quiet day, when no hit comes
    // in to trigger the opportunistic purge.
    host.cron.task('purge', 600, () => purge({}))

    host.health.check('purge', async ({ db, now }) => {
      let stale: number
      try {
        // An hour's grace past the longest window: the purge is throttled,
        // and a hash from 23:59 is legitimately alive for a few minutes after
        // midnight.
        const row = await db.get('SELECT COUNT(*) AS n FROM analytics_seen WHERE created_at < ?', [now.getTime() - 25 * 3_600_000])
        stale = Number(row?.n ?? 0)
      } catch {
        return null
      }

      return stale > 0
        ? check('analytics_purge', 'Analytics purge', 'warn', `${stale} visitor hash(es) are past their window.`,
          'The purge runs on traffic and on GET /api/cron/tick; schedule the cron so the privacy promise holds on quiet days.')
        : check('analytics_purge', 'Analytics purge', 'pass', 'No visitor hashes kept past their window.')
    })
  }
}

export default analytics
