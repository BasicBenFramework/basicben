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
import { startCronInterval } from './host/cron.ts'

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

/**
 * The key webhook signatures are made with.
 *
 * Its own secret, never APP_KEY. Every receiver has to hold the signing key to
 * verify a delivery, and APP_KEY also signs sessions — handing it to a build
 * server or a third-party integration handed them the means to mint an admin
 * login. With no WEBHOOK_SECRET set, deliveries are skipped rather than sent
 * unsigned or signed with something the receiver cannot know.
 */
let warnedNoSecret = false
function webhookSecret(): string | null {
  const secret = process.env.WEBHOOK_SECRET
  if (secret) return secret
  if (!warnedNoSecret) {
    warnedNoSecret = true
    console.warn('[webhooks] WEBHOOK_SECRET is not set; webhook deliveries are skipped.')
  }
  return null
}

for (const [event, kind] of CONTENT_EVENTS) {
  hooks.on(
    event,
    async (payload: Record<string, any>) => {
      const urls = await Settings.getWebhookUrls()

      if (urls.length === 0) return

      const secret = webhookSecret()
      if (!secret) return

      // The record is under its own key — `{ post }`, `{ page }` — except for
      // media, which reports the row directly.
      const record = payload?.[kind] ?? payload

      await deliver({
        urls,
        event,
        data: { id: record?.id ?? null, slug: record?.slug ?? null },
        secret,
        // Production refuses loopback and private addresses, so a webhook
        // URL cannot be pointed at the metadata service or an internal host.
        // A local receiver during development is the normal case, and
        // WEBHOOK_ALLOW_PRIVATE opts a production install in when its receiver
        // really is on the private network (a build service beside it).
        allowPrivate: process.env.NODE_ENV !== 'production' || process.env.WEBHOOK_ALLOW_PRIVATE === 'true'
      })
    },
    { name: `webhook:${event}` }
  )
}

/**
 * The scheduler, on a long-running server: every minute, run whatever core or
 * a feature has scheduled and is due (src/host/cron.ts). On serverless there
 * is no process to keep a timer, so a platform cron calls GET /api/cron/tick.
 */
hooks.on(HOOKS.SERVER_STARTED, async () => startCronInterval(), { name: 'cron:interval' })

/**
 * One value per query key, as the CMS has always read them.
 *
 * Core 0.9 hands a repeated key over as an array (`?tag=a&tag=b` gives
 * `['a', 'b']`). Every reader in the CMS takes a key as one string, many of
 * them through an `as string` that the compiler cannot check, and an array
 * there reaches a model, a `.trim()` or a SQL parameter it was never meant
 * for. So the last value wins, which is what core did before 0.9, and nothing
 * past this point ever sees an array. It runs first (priority 0), ahead of
 * the theme's home page and every route.
 */
hooks.on(
  HOOKS.REQUEST_BEFORE,
  async (context: { req: { query?: Record<string, unknown> } }) => {
    const query = context.req.query
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (Array.isArray(value)) query[key] = value[value.length - 1]
      }
    }
    return context
  },
  { name: 'query:single-values', priority: 0 }
)
