import { timingSafeEqual } from 'node:crypto'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { getDb } from '@basicbenframework/core/db'
import { Post } from '../models/Post'
import { recordHeartbeat, HEARTBEATS } from './heartbeat'
import type { Request, Response } from '../types'

/**
 * Tell listeners about scheduled posts whose time has come.
 *
 * A scheduled post appears on the public site by itself — every read filters
 * on `publish_at` — but nothing *happens* at that moment, so a webhook
 * consumer rebuilding a static site would never hear about it. This finds the
 * posts that have gone live since they were last announced, fires
 * `post.updated` for each (the same event a manual publish fires, so existing
 * consumers need no changes), and marks them announced.
 *
 * Three things call it, so it works on any host:
 * - an interval on a long-running server (see `src/hooks.ts`);
 * - `GET /api/cron/publish-due`, for a platform scheduler such as Vercel Cron;
 * - the content API, at most once a minute, so a serverless deploy with no
 *   scheduler still announces a post the first time anyone reads the site.
 */
export async function publishDue(): Promise<number> {
  const due = await Post.dueForNotification()

  for (const row of due) {
    // Marked first: at-most-once, the same promise webhooks make everywhere
    // else. Two overlapping ticks must not announce a post twice.
    await Post.markNotified(row.id)
    const post = await Post.find(row.id)
    await hooks.fire(HOOKS.POST_UPDATED, { post, previous: row, userId: null, scheduled: true })
  }

  // So the site health page can tell "nothing was due" from "nothing has been
  // checking". At most one write a minute — this whole function is throttled
  // to that — and best-effort: the announcements above already happened.
  await recordHeartbeat((await getDb()) as any, HEARTBEATS.PUBLISH_DUE, { announced: due.length })

  return due.length
}

let lastRun = 0

/** Middleware: run `publishDue` if a minute has passed since it last ran. */
export async function publishDueOpportunistically(_req: Request, _res: Response, next: () => void) {
  if (Date.now() - lastRun > 60_000) {
    lastRun = Date.now()
    try {
      await publishDue()
    } catch (err) {
      console.error('[publish-due]', (err as Error).message)
    }
  }
  next()
}

/**
 * `GET /api/cron/publish-due`, for a platform scheduler.
 *
 * Requires `Authorization: Bearer $CRON_SECRET` — the header Vercel Cron sends
 * — so the endpoint cannot be used to make the server do work on demand. With
 * no CRON_SECRET configured it is disabled.
 */
export async function publishDueEndpoint(req: Request, res: Response) {
  const secret = process.env.CRON_SECRET
  const given = String(req.headers.authorization ?? '')
  const expected = `Bearer ${secret}`

  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return res.json({ error: 'Not found' }, 404)
  }

  lastRun = Date.now()
  res.json({ announced: await publishDue() })
}
