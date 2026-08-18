/**
 * Application hooks.
 *
 * This is where you extend the framework's behaviour. It is imported once by
 * `src/server/index.ts`, so every listener below is registered before the
 * server starts handling requests.
 *
 * ## Two kinds of hook
 *
 * A **filter** transforms a value and must return it. Returning nothing
 * replaces the value with undefined, which is the mistake to watch for.
 *
 * A **notification** is told something happened and its return value is
 * ignored. Throwing from one is contained: the error is logged with the
 * listener's name and the other listeners still run.
 */

import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { deliver } from '@basicbenframework/core/webhooks'
import { Settings } from './models/Settings.ts'

/**
 * Trim titles before a post is written.
 *
 * `post.creating` runs before the insert, so what it returns is what gets
 * stored. Return `{ cancel: true, reason }` instead to refuse the write.
 */
hooks.on(HOOKS.POST_CREATING, async (data: { title?: string }) => ({
  ...data,
  title: data.title?.trim()
}))

/**
 * Content changes, delivered to whatever is configured at /admin/webhooks.
 *
 * This is what stops a headless consumer polling. Delivery is at-most-once —
 * see `@basicbenframework/core/webhooks` for why there is no retry queue — so a
 * consumer that cannot miss an event should poll as a backstop.
 *
 * Every one of these is a *notification*: it is told what happened after the
 * fact, and a failure here cannot fail the write that triggered it.
 */
const CONTENT_EVENTS = [
  [HOOKS.POST_CREATED, 'post'],
  [HOOKS.POST_UPDATED, 'post'],
  [HOOKS.POST_DELETED, 'post'],
  [HOOKS.PAGE_CREATED, 'page'],
  [HOOKS.PAGE_UPDATED, 'page'],
  [HOOKS.PAGE_DELETED, 'page'],
  [HOOKS.MEDIA_UPLOADED, 'media'],
  [HOOKS.MEDIA_DELETED, 'media']
] as const

for (const [event, kind] of CONTENT_EVENTS) {
  hooks.on(
    event,
    async (payload: Record<string, any>) => {
      const urls = await Settings.getWebhookUrls()

      if (urls.length === 0) return

      // The record is under its own key — `{ post }`, `{ page }` — except for
      // media, which reports the row directly.
      const record = payload?.[kind] ?? payload

      await deliver({
        urls,
        event,
        data: { id: record?.id ?? null, slug: record?.slug ?? null },
        secret: process.env.APP_KEY as string
      })
    },
    { name: `webhook:${event}` }
  )
}
