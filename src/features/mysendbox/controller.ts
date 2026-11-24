import { getDb } from '@basicbenframework/core/db'
import { isConfigured, webhookSecret, setting, client } from './config.ts'
import { backfill, contactCounts } from './contacts.ts'
import type { Request, Response } from '../../types'

export const MySendboxController = {
  /**
   * `GET /api/mysendbox/status`: whether it's set up, and how the members
   * stand. `sendable` is MySendbox's own count of who a broadcast would reach
   * now, after its six-month sunset.
   */
  async status(_req: Request, res: Response) {
    const configured = isConfigured()
    const audience = await setting('mysendbox_audience_id')
    let sendable: number | null = null
    let error: string | null = null

    if (configured && audience) {
      const counted = await client().sendableCount(audience)
      if (counted.ok) sendable = Number(counted.data?.sendable ?? 0)
      else error = counted.error
    }

    const db = await getDb()
    const problems = (await db
      .all("SELECT member_id, state, last_error FROM mysendbox_contacts WHERE state IN ('refused', 'needs_consent') OR (state = 'dirty' AND attempts > 0) ORDER BY updated_at DESC LIMIT 20")
      .catch(() => [])) as Array<{ member_id: number; state: string; last_error: string | null }>

    res.json({
      configured,
      webhook: Boolean(webhookSecret()),
      audience_id: audience || null,
      contacts: await contactCounts(),
      sendable,
      problems,
      error
    })
  },

  /** `POST /api/mysendbox/backfill`: copy one batch. The admin calls it until `remaining` is 0. */
  async backfill(_req: Request, res: Response) {
    if (!isConfigured()) return res.json({ error: 'Set MYSENDBOX_API_KEY first.' }, 422)
    try {
      res.json(await backfill(50))
    } catch (err) {
      res.json({ error: String((err as Error)?.message ?? err).slice(0, 300) }, 502)
    }
  }
}
