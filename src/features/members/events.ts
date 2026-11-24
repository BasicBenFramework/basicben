/**
 * What the members feature tells other features, through the framework's
 * hooks. Features do not import each other, so a listener (such as the
 * mysendbox feature) spells these names out; tests check they match.
 *
 * Notifications (the return value is ignored):
 * - `member.created` `{ member }`
 * - `member.updated` `{ member, previous, origin }`: only when something
 *   changed. `origin` is who asked: `'member'`, `'admin'`, or a provider's
 *   name when it is mirroring its own change back (so it can ignore it).
 * - `member.deleted` `{ member }`: the row as it was.
 *
 * Listened to (a provider asks; the members feature decides and writes):
 * - `newsletter.subscription` `{ memberId?, email?, subscribed, provider }`:
 *   a provider that owns unsubscribes (such as MySendbox) reporting someone
 *   unsubscribed or subscribed there. The member's status follows, with
 *   `origin` set to the provider, so its own listener can ignore the echo.
 *
 * Filters:
 * - `newsletter.delivering`: run strict, once per post, before the built-in
 *   queue is filled. See newsletter.ts, `handOffSend`.
 * - `newsletter.status` `{ send, provider }`: a provider may add what it
 *   knows about a send it took (counts, a link). Not strict.
 */

export const MEMBER_HOOKS = {
  CREATED: 'member.created',
  UPDATED: 'member.updated',
  DELETED: 'member.deleted'
} as const

export const NEWSLETTER_HOOKS = {
  DELIVERING: 'newsletter.delivering',
  SUBSCRIPTION: 'newsletter.subscription',
  STATUS: 'newsletter.status'
} as const
