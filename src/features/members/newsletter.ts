/**
 * Newsletters: emailing a post to the members subscribed to them.
 *
 * ## The lifecycle
 *
 * 1. An editor saves a post with "send as newsletter" ticked. That only sets
 *    `posts.send_newsletter` — a request.
 * 2. When the post is *live* (published, not trashed, its time has come), the
 *    `post.created` / `post.updated` listener in src/hooks.ts calls
 *    `queueNewsletterFor`. A scheduled post is announced by the publish-due
 *    tick with `post.updated`, so it is mailed when it goes live, not when it
 *    was scheduled.
 * 3. `queueNewsletterFor` creates the post's one `newsletter_sends` row — its
 *    `post_id` is unique, which is the "only once per post" guarantee — and
 *    copies every subscribed member into `newsletter_queue`.
 * 4. `processNewsletterQueue(limit)` sends up to `limit` queued mails and
 *    returns. It is called from an interval on a long-running server, from
 *    `GET /api/cron/newsletters` for a platform scheduler, and opportunistically
 *    from the admin. Each call picks up where the last stopped, which is what
 *    makes this work on a serverless host with a ten-second function budget.
 *
 * ## Never twice
 *
 * A member gets a post at most once. The queue's UNIQUE (send_id, member_id)
 * means enqueueing again adds nobody; a row is *claimed* with a conditional
 * UPDATE before its mail goes, so two overlapping processors cannot both send
 * it; and a row that was claimed but never finished — the function was frozen
 * mid-send — is marked failed rather than retried, because nothing can tell
 * whether its mail left before the process died. That is at-most-once, the
 * same promise webhooks make. A provider error, by contrast, is a known
 * non-delivery and is retried up to MAX_ATTEMPTS.
 */

import { timingSafeEqual } from 'node:crypto'
import { getDb } from '@basicbenframework/core/db'
import { sendMail, renderMail, getMailer, extractAddress } from '@basicbenframework/core/mail'
import { sanitizeHtml, stripTags } from '@basicbenframework/core/content'
import { absoluteUrl } from '@basicbenframework/core/storage'
import { can } from '@basicbenframework/core/auth/permissions'
import { livePost } from '../../models/visibility.ts'
import { Settings } from '../../models/Settings.ts'
import { siteUrl } from '../../helpers/site.ts'
import { issueMemberUnsubscribeToken, pruneMagicLinks } from './session.ts'
import type { Request, Response } from '../../types'

/** Tries per recipient before a provider error is final. */
export const MAX_ATTEMPTS = 3

/** A claimed row older than this was interrupted, not slow. */
export const STALE_CLAIM_MS = 15 * 60 * 1000

/** Mails per processor call when none is given. */
export const DEFAULT_BATCH = 50

const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')

type Send = (message: Record<string, unknown>) => Promise<unknown>

export interface NewsletterSendRow {
  id: number
  post_id: number
  status: 'preparing' | 'sending' | 'sent'
  subject: string | null
  total_count: number
  sent_count: number
  failed_count: number
  skipped_count: number
  created_at: string
  started_at: string | null
  completed_at: string | null
}

/**
 * May this request ask for a post to be mailed to every member?
 *
 * Mailing the whole list is a bigger act than publishing one post, so it is
 * `post.edit` held outright — editors and admins — as Ghost reserves sending
 * for editors. An author can publish their own post; they cannot email it to
 * everyone. Only *turning it on* is checked: re-saving a post whose flag is
 * already set must not fail for the author who wrote it.
 *
 * Returns the refusal, or null.
 */
export function newsletterRefusal(
  req: Request,
  values: Record<string, unknown>,
  existing: { send_newsletter?: unknown } | null
): string | null {
  if (!values.send_newsletter || Number(existing?.send_newsletter ?? 0)) return null
  return can(req.user, 'post.edit') ? null : 'Only an editor can send a post as a newsletter.'
}

/** The post's send, if it has one. */
export async function newsletterFor(postId: number): Promise<NewsletterSendRow | undefined> {
  const db = await getDb()
  return db.get('SELECT * FROM newsletter_sends WHERE post_id = ?', [postId])
}

/**
 * Queue a post's newsletter, if it asked for one, is live, and has none yet.
 *
 * Safe to call any number of times, from any number of places at once: the
 * unique `post_id` lets exactly one send row exist, and `prepareSend` adds
 * only recipients not already queued. Returns the send, or null when there is
 * nothing to send.
 */
export async function queueNewsletterFor(postId: number): Promise<NewsletterSendRow | null> {
  const db = await getDb()

  const post = (await db.get(
    `SELECT id, title, send_newsletter FROM posts WHERE id = ? AND ${livePost('posts')}`,
    [postId]
  )) as { id: number; title: string; send_newsletter: number } | undefined

  if (!post || !Number(post.send_newsletter)) return null

  let send = await newsletterFor(post.id)

  if (!send) {
    try {
      await db.run(
        'INSERT INTO newsletter_sends (post_id, status, subject, created_at) VALUES (?, ?, ?, ?)',
        [post.id, 'preparing', post.title, new Date().toISOString()]
      )
    } catch {
      // Lost the race to another caller: the unique index did its job, and
      // their row is the one to use.
    }
    send = await newsletterFor(post.id)
  }

  if (send?.status === 'preparing') await prepareSend(send.id)

  return (await newsletterFor(post.id)) ?? null
}

/**
 * Copy the subscribed members into the queue, then mark the send sending.
 *
 * One INSERT … SELECT, so a large list is one statement rather than a round
 * trip per member. `NOT EXISTS` rather than ON CONFLICT so it is the same SQL
 * on SQLite, libSQL and Postgres; the unique index is still there behind it.
 * The id and timestamp are inlined because Postgres cannot always infer a
 * parameter's type in a SELECT list — both are our own values, never input.
 */
async function prepareSend(sendId: number): Promise<void> {
  const db = await getDb()
  const id = Number(sendId)
  if (!Number.isInteger(id)) return

  const now = new Date().toISOString()

  await db.run(
    `INSERT INTO newsletter_queue (send_id, member_id, email, status, attempts, created_at)
     SELECT ${id}, m.id, m.email, 'pending', 0, '${now}'
     FROM members m
     WHERE m.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM newsletter_queue q WHERE q.send_id = ${id} AND q.member_id = m.id)`
  )

  await db.run(
    `UPDATE newsletter_sends
     SET status = 'sending', started_at = ?,
         total_count = (SELECT COUNT(*) FROM newsletter_queue WHERE send_id = ?)
     WHERE id = ? AND status = 'preparing'`,
    [now, id, id]
  )

  // A list with nobody subscribed is finished the moment it starts.
  await refreshCounts(id)
}

/** Recount a send from its queue, and close it when nothing is left to do. */
async function refreshCounts(sendId: number): Promise<void> {
  const db = await getDb()
  const rows = (await db.all(
    'SELECT status, COUNT(*) AS total FROM newsletter_queue WHERE send_id = ? GROUP BY status',
    [sendId]
  )) as Array<{ status: string; total: number | string }>

  const of = (status: string) => Number(rows.find(row => row.status === status)?.total) || 0
  const total = rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0)
  const open = of('pending') + of('sending')

  await db.run(
    `UPDATE newsletter_sends
     SET total_count = ?, sent_count = ?, failed_count = ?, skipped_count = ?,
         status = CASE WHEN ? = 0 AND status = 'sending' THEN 'sent' ELSE status END,
         completed_at = CASE WHEN ? = 0 AND status = 'sending' THEN ? ELSE completed_at END
     WHERE id = ?`,
    [total, of('sent'), of('failed'), of('skipped'), open, open, new Date().toISOString(), sendId]
  )
}

interface PostForMail {
  id: number
  title: string
  slug: string | null
  excerpt: string | null
  content_html: string | null
}

/**
 * Make every link and image in a post's HTML absolute.
 *
 * A mail client has no page to resolve `/uploads/x.png` or `/blog/other`
 * against. Images resolve against APP_URL — where local storage serves them —
 * and links against the public site, the same split the content API uses.
 * Only root-relative values are touched; `//host` and absolute URLs are left
 * alone, and anything else the sanitizer already refused.
 */
export function absolutize(html: string, site = siteUrl(), app = appUrl()): string {
  return html.replace(/(\s(href|src)=")(\/(?!\/)[^"]*)"/gi, (_match, prefix: string, attr: string, path: string) => {
    const base = attr.toLowerCase() === 'src' ? app : site
    return `${prefix}${base ? absoluteUrl(path, base) : path}"`
  })
}

/** The public URL of a post, as the feeds build it. */
export function postUrl(post: { id: number; slug: string | null }): string {
  return `${siteUrl()}/blog/${post.slug || post.id}`
}

/** A display name that cannot break out of a From header. */
function cleanName(value: string): string {
  return value.replace(/[\r\n"<>\\]/g, '').trim().slice(0, 100)
}

/**
 * The message for one recipient.
 *
 * The body is sanitized again here even though `content_html` is already a
 * sanitized render: it is about to be delivered outside the site, to mail
 * clients with their own idea of what is safe, and a listener on
 * `content.save` may have put something in the column the sanitizer would
 * not. Sanitizing twice costs microseconds; trusting a cache is how a stored
 * value becomes a mail-borne one.
 */
export async function buildNewsletterMessage(
  post: PostForMail,
  recipient: { email: string; memberId: number | null }
): Promise<Record<string, unknown>> {
  const [siteName, senderName, replyTo, footer] = await Promise.all([
    Settings.getSiteName(),
    Settings.get('newsletter_sender_name'),
    Settings.get('newsletter_reply_to'),
    Settings.get('newsletter_footer')
  ])

  const contentHtml = absolutize(sanitizeHtml(post.content_html ?? ''))

  // A test send goes to someone who is not a member; their link names nobody
  // and the unsubscribe page says so rather than unsubscribing a stranger.
  const unsubscribeUrl = `${appUrl()}/api/v1/members/unsubscribe?token=${encodeURIComponent(
    issueMemberUnsubscribeToken(recipient.memberId ?? 0)
  )}`

  const { from } = await getMailer()
  const name = cleanName(senderName || siteName)
  const address = from ? extractAddress(from) : ''

  return {
    to: recipient.email,
    ...(address && name ? { from: `"${name}" <${address}>` } : {}),
    ...(replyTo ? { replyTo } : {}),
    subject: post.title,
    // RFC 8058 one-click: the mail client's own unsubscribe button POSTs to
    // the same link, so a reader never has to find it in the body — and
    // Gmail and Yahoo require it of bulk senders.
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      Precedence: 'bulk'
    },
    ...renderMail('newsletter', {
      title: post.title,
      siteName,
      postUrl: postUrl(post),
      contentHtml,
      contentText: stripTags(contentHtml),
      footer: footer || '',
      unsubscribeUrl
    })
  }
}

/**
 * Send up to `limit` queued newsletter mails. Resumable; see the file header.
 *
 * `send` is the transport, injectable so a test can make delivery fail
 * without a mail provider. Returns what it did.
 */
export async function processNewsletterQueue(
  limit = DEFAULT_BATCH,
  { send = sendMail as Send }: { send?: Send } = {}
): Promise<{ sent: number; failed: number; skipped: number; retried: number }> {
  const db = await getDb()
  const outcome = { sent: 0, failed: 0, skipped: 0, retried: 0 }
  const touched = new Set<number>()

  // Sends whose queueing was interrupted finish queueing first.
  const preparing = (await db.all("SELECT id FROM newsletter_sends WHERE status = 'preparing'")) as Array<{ id: number }>
  for (const row of preparing) await prepareSend(row.id)

  // Claimed and never finished: the process died mid-send. Not retried — see
  // "Never twice" above.
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const stale = (await db.all(
    "SELECT DISTINCT send_id FROM newsletter_queue WHERE status = 'sending' AND claimed_at < ?",
    [staleBefore]
  )) as Array<{ send_id: number }>

  if (stale.length) {
    await db.run(
      "UPDATE newsletter_queue SET status = 'failed', error = ? WHERE status = 'sending' AND claimed_at < ?",
      ['Interrupted while sending; not retried in case it was delivered', staleBefore]
    )
    for (const row of stale) touched.add(Number(row.send_id))
  }

  const batch = Math.max(1, Math.min(500, Math.floor(Number(limit) || DEFAULT_BATCH)))

  const candidates = (await db.all(
    `SELECT q.id, q.send_id, q.member_id, q.attempts
     FROM newsletter_queue q
     JOIN newsletter_sends s ON s.id = q.send_id
     WHERE q.status = 'pending' AND s.status = 'sending'
     ORDER BY q.id ASC
     LIMIT ?`,
    [batch]
  )) as Array<{ id: number; send_id: number; member_id: number; attempts: number }>

  // Each send's post is read once per batch, not once per recipient.
  const posts = new Map<number, PostForMail | null>()

  for (const row of candidates) {
    const now = new Date().toISOString()

    // The claim. Whoever changes the row owns it; everyone else moves on.
    const claim = await db.run(
      "UPDATE newsletter_queue SET status = 'sending', claimed_at = ?, attempts = attempts + 1 WHERE id = ? AND status = 'pending'",
      [now, row.id]
    )
    if (Number(claim?.changes ?? 0) !== 1) continue

    touched.add(Number(row.send_id))

    const member = (await db.get('SELECT id, email, status FROM members WHERE id = ?', [row.member_id])) as
      | { id: number; email: string; status: string }
      | undefined

    // Unsubscribed (or deleted) since the queue was built: their wish now
    // beats the list as it was then.
    if (!member || member.status !== 'active') {
      await db.run("UPDATE newsletter_queue SET status = 'skipped', error = ? WHERE id = ?", ['No longer subscribed', row.id])
      outcome.skipped++
      continue
    }

    if (!posts.has(row.send_id)) {
      posts.set(row.send_id, ((await db.get(
        `SELECT p.id, p.title, p.slug, p.excerpt, p.content_html
         FROM newsletter_sends s JOIN posts p ON p.id = s.post_id
         WHERE s.id = ? AND ${livePost('p')}`,
        [row.send_id]
      )) as PostForMail | undefined) ?? null)
    }

    const post = posts.get(row.send_id)

    // Unpublished or trashed mid-send. The rest of the list does not get it:
    // the editor took it down for a reason.
    if (!post) {
      await db.run("UPDATE newsletter_queue SET status = 'skipped', error = ? WHERE id = ?", ['Post is no longer published', row.id])
      outcome.skipped++
      continue
    }

    try {
      await send(await buildNewsletterMessage(post, { email: member.email, memberId: member.id }))
      await db.run("UPDATE newsletter_queue SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?", [new Date().toISOString(), row.id])
      outcome.sent++
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 500)
      const attempts = Number(row.attempts) + 1

      // A provider error is a known non-delivery, so it may be tried again —
      // on the next call, which is at least the next tick.
      if (attempts >= MAX_ATTEMPTS) {
        await db.run("UPDATE newsletter_queue SET status = 'failed', error = ? WHERE id = ?", [message, row.id])
        outcome.failed++
      } else {
        await db.run("UPDATE newsletter_queue SET status = 'pending', error = ? WHERE id = ?", [message, row.id])
        outcome.retried++
      }
    }
  }

  for (const sendId of touched) await refreshCounts(sendId)

  return outcome
}

/**
 * Mail a post to one address as members will see it, without queueing.
 *
 * For "send a test to yourself". Works on drafts — previewing before
 * publishing is the point — and never touches the queue or the send row.
 */
export async function sendTestNewsletter(postId: number, to: string, send: Send = sendMail as Send): Promise<boolean> {
  const db = await getDb()
  const post = (await db.get(
    'SELECT id, title, slug, excerpt, content_html FROM posts WHERE id = ? AND deleted_at IS NULL',
    [postId]
  )) as PostForMail | undefined

  if (!post) return false

  const message = await buildNewsletterMessage(post, { email: to, memberId: null })
  await send({ ...message, subject: `[Test] ${post.title}` })
  return true
}

/**
 * Run a job without the request waiting for it, and never let it throw.
 *
 * As comment-mail's `inBackground`: on a serverless host the function may be
 * frozen before it finishes, which costs nothing here — the queue resumes.
 */
function inBackground(job: () => Promise<unknown>): void {
  Promise.resolve().then(job).catch(err => console.error('[newsletter]', (err as Error)?.message ?? err))
}

let lastRun = 0

/** Kick a small batch at most once a minute, without delaying the request. */
export function kickNewsletterQueue(limit = 10): void {
  if (Date.now() - lastRun < 60_000) return
  lastRun = Date.now()
  inBackground(() => processNewsletterQueue(limit))
}

/** Middleware form of `kickNewsletterQueue`, for routes with traffic. */
export function newslettersOpportunistically(_req: Request, _res: Response, next: () => void) {
  kickNewsletterQueue()
  next()
}

/**
 * `GET /api/cron/newsletters`, for a platform scheduler.
 *
 * The same rule as `/api/cron/publish-due`: `Authorization: Bearer
 * $CRON_SECRET`, and with no secret configured the endpoint does not exist.
 * `?limit=` sizes the batch (default 100, at most 500) so a host with a short
 * function timeout can ask for less.
 */
export async function newslettersCronEndpoint(req: Request, res: Response) {
  const secret = process.env.CRON_SECRET
  const given = String(req.headers.authorization ?? '')
  const expected = `Bearer ${secret}`

  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return res.json({ error: 'Not found' }, 404)
  }

  lastRun = Date.now()
  const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100))
  const outcome = await processNewsletterQueue(limit)
  // Housekeeping that needs a tick and has no other: spent magic links.
  await pruneMagicLinks().catch(() => {})
  res.json(outcome)
}
