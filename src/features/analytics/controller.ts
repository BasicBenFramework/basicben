import { clientIp } from '../../middleware/rate-limits.ts'
import {
  normalizeAnalyticsPath,
  referrerDomain,
  hostOf,
  isBot,
  optedOut,
  parseHitBody
} from './helpers.ts'
import { recordHit, summary, analyticsSettings, purgeOpportunistically } from './model.ts'
import type { Request, Response } from '../../types'

/** The ranges the admin offers. Anything else is refused, not clamped. */
const RANGES = [7, 30, 90]

/** 204 with nothing to cache: a hit is never a resource. */
function accepted(res: Response) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(204).end()
}

/**
 * Cookieless page-view counting. The privacy model is in this folder's README.md.
 */
export const AnalyticsController = {
  /**
   * `POST /api/v1/analytics/hit` — `{ path, referrer? }`, from any origin.
   *
   * Public, like posting a comment, because the reader's browser is the
   * caller and it has no credential to send. It answers 204 whether or not
   * the hit was counted — a bot, an opt-out and a disabled site all look the
   * same from outside, so the response tells a scraper nothing — and 400 only
   * for a request that could never be counted, which is a front end's bug
   * worth surfacing while it is being built.
   */
  async hit(req: Request, res: Response) {
    const body = parseHitBody(req.body)
    const path = normalizeAnalyticsPath(body.path)

    if (!path) {
      return res.json({ error: 'path must be a path starting with / (or an http(s) URL)' }, 400)
    }

    // Opt-outs and bots are not counted at all — not counted and discarded,
    // not counted: nothing about the request is written.
    if (optedOut(req.headers) || isBot(req.headers['user-agent'])) return accepted(res)

    try {
      const settings = await analyticsSettings()
      if (!settings.enabled) return accepted(res)

      const ownHosts = [
        hostOf(process.env.SITE_URL),
        hostOf(process.env.APP_URL),
        hostOf(req.headers.origin),
        hostOf(body.path)
      ].filter((h): h is string => Boolean(h))

      await recordHit({
        path,
        referrer: referrerDomain(body.referrer, ownHosts),
        address: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? ''),
        pepper: process.env.APP_KEY ?? ''
      })

      await purgeOpportunistically()
    } catch (err) {
      // A failed count is not the reader's problem, and their page has long
      // since moved on. Logged without the request: no address in the logs.
      console.error('[analytics] hit not recorded:', (err as Error).message)
    }

    accepted(res)
  },

  /** `GET /api/admin/analytics?days=7|30|90` */
  async summary(req: Request, res: Response) {
    const days = req.query.days === undefined ? 30 : Number(req.query.days)

    if (!RANGES.includes(days)) {
      return res.json({ errors: { days: [`Must be one of ${RANGES.join(', ')}`] } }, 422)
    }

    // A quiet site still forgets on time when its admin looks at the page.
    await purgeOpportunistically()

    const [data, settings] = await Promise.all([summary({ days }), analyticsSettings()])

    res.json({
      data,
      settings: {
        analytics_enabled: settings.enabled,
        analytics_dedup_hours: settings.dedupHours,
        analytics_retention_days: settings.retentionDays
      }
    })
  }
}
