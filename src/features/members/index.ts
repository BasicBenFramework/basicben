/**
 * Members, members-only posts and newsletters, as a feature.
 *
 * Remove this folder and its lines in src/features.ts, src/client/features.ts
 * and src/features.manifest.ts, and the core runs without it. Its tables
 * (migrations 033–035) and the `visibility` and `send_newsletter` columns stay,
 * and core keeps withholding any post saved as `members` or `paid`: with no
 * access policy, nothing but `public` is readable. How it all works:
 * README.md.
 */

import './request.ts'
import { HOOKS } from '@basicbenframework/core/hooks'
import type { Feature } from '../../host'
import type { Request } from '../../types'
import { MEMBER_SETTINGS } from './settings.ts'
import { memberRoutes } from './routes.ts'
import { memberFromRequest } from './middleware.ts'
import { Member, type MemberRow } from './Member.ts'
import { queueNewsletterFor, processNewsletterQueue, kickNewsletterQueue, newsletterRefusal } from './newsletter.ts'
import { pruneMagicLinks, normalizeEmail } from './session.ts'
import { NEWSLETTER_HOOKS } from './events.ts'

/** The levels this feature offers. `paid` is enforced as `members` until paid tiers exist (migration 034). */
export const MEMBER_LEVELS = ['members', 'paid']

/**
 * The editor's newsletter checkbox, saved through core's own save.
 *
 * Core does not know the field; it reaches the post through the
 * `post.creating` / `post.updating` filters, which run inside core's save, so
 * a post that has never been saved can ask for a send in the same request
 * that creates it. Asking is an editor's call (`newsletterRefusal`); anyone
 * else is refused with a 403, the status this check always had.
 */
export function withNewsletterRequest(
  value: Record<string, unknown> | null | undefined,
  context: { req?: Request; post?: { send_newsletter?: unknown } | null }
) {
  const body = (context?.req?.body ?? {}) as Record<string, unknown>
  if (!value || value.cancel || !('send_newsletter' in body)) return value

  const values = { send_newsletter: body.send_newsletter ? 1 : 0 }
  const refusal = newsletterRefusal(context.req as Request, values, context.post ?? null)
  if (refusal) return { ...value, cancel: true, reason: refusal, status: 403 }

  return { ...value, ...values }
}

/**
 * A provider reporting a subscription change made on its side (an
 * unsubscribe link in its mail, a bounce). Its status wins for newsletters,
 * so the member follows. Unknown people are ignored: the provider may have
 * contacts who never became members here.
 */
export async function applySubscription(payload: {
  memberId?: unknown
  email?: unknown
  subscribed?: unknown
  provider?: unknown
}): Promise<void> {
  const provider = String(payload?.provider || 'provider').slice(0, 50)
  const id = Number(payload?.memberId)
  let member = Number.isInteger(id) && id > 0 ? await Member.find(id) : undefined
  if (!member && typeof payload?.email === 'string') member = await Member.findByEmail(normalizeEmail(payload.email))
  if (!member) return

  const status = payload.subscribed ? 'active' : 'unsubscribed'
  if (member.status !== status) await Member.update(member.id, { status }, { origin: provider })
}

const members: Feature = {
  name: 'members',

  register(host) {
    host.settings.define(MEMBER_SETTINGS)
    host.routes(memberRoutes)

    // Who may read a members-only post: anyone with a member session. The
    // session comes from X-Member-Token (or a bearer header that verifies as
    // one), and is checked against the member's row on every request.
    host.access.policy<MemberRow>({
      levels: MEMBER_LEVELS,
      headers: ['X-Member-Token'],
      async identify(req) {
        const member = await memberFromRequest(req)
        if (member) await Member.touch(member).catch(() => {})
        return member
      },
      mayRead: (post, member) => Boolean(member) && MEMBER_LEVELS.includes(String(post.visibility))
    })

    host.hooks.on(NEWSLETTER_HOOKS.SUBSCRIPTION, applySubscription, { name: 'members:subscription' })
    host.hooks.on(HOOKS.POST_CREATING, withNewsletterRequest, { name: 'members:newsletter-request' })
    host.hooks.on(HOOKS.POST_UPDATING, withNewsletterRequest, { name: 'members:newsletter-request' })

    // Email a post to members when it goes live, if its author asked. Both
    // events, because a post can go live through either: created already
    // published, or updated into it — by the editor, a bulk action, or the
    // publish-due task announcing a scheduled post whose time came. The
    // listener only *queues*; `queueNewsletterFor` checks the post is live,
    // asked for a send and has none yet, so firing it on every save is
    // harmless.
    for (const event of [HOOKS.POST_CREATED, HOOKS.POST_UPDATED]) {
      host.hooks.on(
        event,
        async (payload: { post?: { id?: number } }) => {
          const id = Number(payload?.post?.id)
          if (!Number.isInteger(id)) return

          const send = await queueNewsletterFor(id)
          // Start sending now rather than at the next tick. In the
          // background: the editor's save should not wait on a mail provider.
          if (send && send.status !== 'sent') kickNewsletterQueue(25)
        },
        { name: `members:newsletter:${event}` }
      )
    }

    // The queue is resumable, so a batch a minute finishes any send the kick
    // above started, and picks up one a serverless function was frozen in.
    host.cron.task('newsletters', 60, () => processNewsletterQueue(100))
    host.cron.task('prune-magic-links', 3600, () => pruneMagicLinks())
  }
}

export default members
