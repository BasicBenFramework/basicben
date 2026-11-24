/**
 * The two emails comments send.
 *
 * - To the people who look after a post, when a comment on it is waiting for
 *   moderation. Who that is — the post's author, everyone who can moderate,
 *   both, or nobody — is the `comment_notify` setting.
 * - To a commenter, when someone's reply to them is approved, and only if
 *   they ticked the box asking for it. Each of those mails carries a signed
 *   link that turns it off without an account.
 *
 * Neither may cost the commenter anything. Both run after the response is
 * decided, are never awaited by the request, and log rather than throw: a
 * mail provider being down is not a reason for a comment to fail, and a slow
 * one is not a reason for the form to hang.
 *
 * The cost of not awaiting is the one PasswordResetController describes — on
 * a serverless deploy the function can be frozen once the response is
 * written, and a mail still in flight may never leave. For a reset link that
 * would be the whole feature; for a courtesy notification it is an acceptable
 * loss, and the moderation queue is still there whether or not the mail was.
 */

import { sendMail } from '@basicbenframework/core/mail'
// The site's mail/ first, then the CMS's.
import { renderMail } from './mail-templates.ts'
import { capabilitiesFor, ROLES } from '@basicbenframework/core/auth/permissions'
import { getDb } from '@basicbenframework/core/db'
import { Comment } from '../models/Comment.ts'
import { Settings } from '../models/Settings.ts'
import { issueUnsubscribeToken } from './comment-guard.ts'
import type { Comment as CommentType } from '../types/index.ts'

const appUrl = () => process.env.APP_URL || 'http://localhost:3000'

export type NotifyAudience = 'author' | 'moderators' | 'both' | 'none'
export const NOTIFY_AUDIENCES: NotifyAudience[] = ['author', 'moderators', 'both', 'none']

/** Who hears about comments awaiting moderation. The author, unless told otherwise. */
export async function notifyAudience(): Promise<NotifyAudience> {
  const value = await Settings.get('comment_notify')
  return (NOTIFY_AUDIENCES as string[]).includes(value ?? '') ? value as NotifyAudience : 'author'
}

/**
 * Run a mail job without the request waiting for it.
 *
 * The catch is the point: an unhandled rejection here would take the process
 * down on Node's default settings, over an email.
 */
export function inBackground(label: string, job: () => Promise<unknown>): void {
  Promise.resolve()
    .then(job)
    .catch(err => console.error(`[comments] ${label} failed:`, (err as Error)?.message ?? err))
}

interface Recipient {
  id: number
  name: string
  email: string
  role: string | null
}

/** Roles whose holders can moderate, read from the capability table rather than named here. */
function moderatingRoles(): string[] {
  return Object.values(ROLES).filter(role => {
    const caps = capabilitiesFor(role)
    return caps.includes('*') || caps.includes('comment.moderate')
  })
}

function canModerate(role: string | null): boolean {
  return role !== null && moderatingRoles().includes(role)
}

/**
 * Accounts that may be mailed: not disabled, and with an address they proved.
 *
 * An unverified address may belong to someone other than whoever typed it,
 * and a comment's text is not something to send them. Null is treated as
 * verified, for rows that predate verification — as auth.ts does.
 */
const MAILABLE = 'disabled_at IS NULL AND (email_verified IS NULL OR email_verified <> 0)'

async function recipientsFor(post: { user_id?: number | null }, audience: NotifyAudience): Promise<Recipient[]> {
  if (audience === 'none') return []
  const db = await getDb()
  const found = new Map<string, Recipient>()

  if ((audience === 'author' || audience === 'both') && post.user_id) {
    const author = await db.get(`SELECT id, name, email, role FROM users WHERE id = ? AND ${MAILABLE}`, [post.user_id]) as Recipient | undefined
    if (author?.email) found.set(author.email.toLowerCase(), author)
  }

  if (audience === 'moderators' || audience === 'both') {
    const roles = moderatingRoles()
    if (roles.length) {
      const rows = await db.all(
        `SELECT id, name, email, role FROM users WHERE role IN (${roles.map(() => '?').join(', ')}) AND ${MAILABLE}`,
        roles
      ) as Recipient[]
      for (const row of rows) if (row.email) found.set(row.email.toLowerCase(), row)
    }
  }

  return [...found.values()]
}

/**
 * Tell the post's people that a comment is waiting for them.
 *
 * Only for `pending`: an approved comment needs nothing from anyone, and
 * mailing a moderator every time the spam folder catches a bot would train
 * them to ignore the mail that matters.
 */
export async function notifyAwaitingModeration(
  comment: CommentType,
  post: { id: number; title: string; user_id?: number | null }
): Promise<void> {
  if (comment.status !== 'pending') return

  const audience = await notifyAudience()
  const recipients = await recipientsFor(post, audience)
  if (!recipients.length) return

  const siteName = await Settings.getSiteName()
  const commenterName = comment.author_name || 'Someone'
  const audienceLabel = audience === 'author' ? 'post authors'
    : audience === 'moderators' ? 'moderators'
      : 'post authors and moderators'

  for (const recipient of recipients) {
    // Nobody needs an email about their own comment.
    if (comment.user_id && Number(comment.user_id) === Number(recipient.id)) continue

    // An author who cannot moderate gets the post, not an admin page that
    // would refuse them.
    const moderates = canModerate(recipient.role)
    const actionUrl = moderates
      ? `${appUrl()}/admin/comments?status=pending`
      : `${appUrl()}/feed/${post.id}`

    await sendMail({
      to: recipient.email,
      subject: `New comment awaiting moderation on "${post.title}"`,
      ...renderMail('comment-moderation', {
        name: recipient.name,
        commenterName,
        postTitle: post.title,
        content: comment.content,
        actionUrl,
        actionLabel: moderates ? 'Review it' : 'View the post',
        siteName,
        audience: audienceLabel
      })
    }).catch(err => {
      // One bad address must not stop the rest of the list.
      console.error('[comments] moderation notice failed:', (err as Error)?.message ?? err)
    })
  }
}

/**
 * Tell a commenter that their comment has an approved reply, if they asked.
 *
 * Called whenever a reply becomes approved — on creation or by a moderator —
 * and safe to call twice: `claimReplyNotification` lets exactly one call
 * through per reply, ever.
 */
export async function notifyParentOfReply(replyId: number): Promise<void> {
  const reply = await Comment.find(replyId)
  if (!reply || reply.status !== 'approved' || !reply.parent_id) return

  const parent = await Comment.find(Number(reply.parent_id))
  if (!parent || !Number(parent.notify_replies)) return

  // The account's address for a signed-in commenter — their own, kept current
  // — or the one a guest typed.
  const to = String((parent as { user_email?: string }).user_email || parent.author_email || '').trim()
  if (!to) return

  // Answering yourself is not news.
  const replyEmail = String((reply as { user_email?: string }).user_email || reply.author_email || '').trim().toLowerCase()
  const sameAccount = reply.user_id && parent.user_id && Number(reply.user_id) === Number(parent.user_id)
  if (sameAccount || (replyEmail && replyEmail === to.toLowerCase())) return

  if (!(await Comment.claimReplyNotification(Number(reply.id)))) return

  const db = await getDb()
  const post = await db.get('SELECT id, title FROM posts WHERE id = ?', [reply.post_id]) as { id: number; title: string } | undefined
  if (!post) return

  const unsubscribeUrl = `${appUrl()}/api/comments/unsubscribe?token=${encodeURIComponent(issueUnsubscribeToken(Number(parent.id)))}`
  const replyUrl = `${appUrl()}/feed/${post.id}#comment-${reply.id}`
  const name = (parent as { user_name?: string }).user_name || parent.author_name || 'there'
  const replierName = (reply as { user_name?: string }).user_name || reply.author_name || 'Someone'

  await sendMail({
    to,
    subject: `${replierName} replied to your comment on "${post.title}"`,
    // RFC 8058 one-click: a mail client's own unsubscribe button POSTs to the
    // same link, so the reader never has to find it in the body.
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    },
    ...renderMail('comment-reply', {
      name,
      replierName,
      postTitle: post.title,
      content: reply.content,
      replyUrl,
      unsubscribeUrl,
      siteName: await Settings.getSiteName()
    })
  })
}
