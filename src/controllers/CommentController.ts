import { validate, rules } from '@basicbenframework/core/validation'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { Comment } from '../models/Comment'
import { Settings } from '../models/Settings'
import { Post } from '../models/Post'
import { can } from '@basicbenframework/core/auth/permissions'
import { paginationFrom, meta } from '../models/pagination'
import { clientIp } from '../middleware/rate-limits'
import { guardWrite } from '../helpers/write-hooks'
import {
  MAX_DEPTH, HONEYPOT_FIELD, DEFAULT_MAX_LINKS, COMMENT_STATUSES,
  isCommentStatus, issueFormToken, readUnsubscribeToken, parseBlocklist, assess,
  type CommentStatus
} from '../helpers/comment-guard'
import {
  inBackground, notifyAwaitingModeration, notifyParentOfReply, notifyAudience, NOTIFY_AUDIENCES
} from '../helpers/comment-mail'
import type { Request, Response, Comment as CommentType } from '../types'

/** The most comments one bulk action may touch: a page and then some. */
const MAX_BULK = 200

/** The blocklist setting's size cap. Thousands of entries, not a megabyte of text. */
const MAX_BLOCKLIST_LENGTH = 20_000

/**
 * What the commenter is told about the comment they just posted.
 *
 * Built field by field: the stored row carries their address and IP, and
 * nothing else in this response needs either. Spam is reported as pending —
 * telling a bot which of its tricks was caught is telling it what to change.
 */
function submitted(comment: CommentType) {
  const status = comment.status === 'approved' ? 'approved' : 'pending'
  return {
    id: comment.id,
    post_id: comment.post_id,
    parent_id: comment.parent_id ?? null,
    author_name: comment.author_name ?? null,
    content: comment.content,
    created_at: comment.created_at,
    approved: status === 'approved',
    status
  }
}

/** The ids in a request body, as positive integers, deduplicated and capped. */
function idsFrom(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const ids = [...new Set(value.map(Number).filter(id => Number.isInteger(id) && id > 0))]
  return ids.length && ids.length <= MAX_BULK ? ids : null
}

/** Everything that should follow a comment becoming approved. */
async function afterApproved(changed: CommentType[], userId?: number) {
  for (const comment of changed) {
    await hooks.fire(HOOKS.COMMENT_APPROVED, { comment, userId })
    if (comment.parent_id) {
      inBackground('reply notification', () => notifyParentOfReply(Number(comment.id)))
    }
  }
}

async function commentSettings() {
  const maxLinks = Number.parseInt((await Settings.get('comment_max_links')) ?? '', 10)
  return {
    comment_blocklist: (await Settings.get('comment_blocklist')) ?? '',
    comment_max_links: Number.isInteger(maxLinks) && maxLinks >= 0 ? maxLinks : DEFAULT_MAX_LINKS,
    comment_notify: await notifyAudience()
  }
}

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** A bare page for the unsubscribe link, which is opened from a mail client, not the app. */
function page(res: Response, status: number, title: string, body: string) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Never cached, and never indexed: the URL carries a token.
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.status(status).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 48px auto; padding: 0 16px; color: #111; line-height: 1.5;">
<h1 style="font-size: 20px;">${escapeHtml(title)}</h1>
${body}
</body></html>`)
}

export const CommentController = {
  /**
   * The moderation list: one status, one page, and the count behind every tab.
   *
   * `?status=` is pending, approved, spam, trash or all (pending and approved
   * together). It used to return every comment ever written, in one response.
   */
  async index(req: Request, res: Response) {
    const query = (req.query ?? {}) as Record<string, string>
    const status = query.status === undefined || query.status === 'all'
      ? 'all'
      : isCommentStatus(query.status) ? query.status : null
    if (!status) {
      return res.json({ errors: { status: [`Must be one of: all, ${COMMENT_STATUSES.join(', ')}`] } }, 422)
    }

    const { page, perPage, offset } = paginationFrom(query)
    const [{ comments, total }, counts] = await Promise.all([
      Comment.list({ status, limit: perPage, offset }),
      Comment.counts()
    ])

    res.json({ comments, counts, meta: meta(page, perPage, total) })
  },

  async pending(req: Request, res: Response) {
    const comments = await Comment.findPending()
    const count = await Comment.countPending()
    res.json({ comments, count })
  },

  /**
   * A post's comments.
   *
   * For readers, the approved comments as a tree — see
   * `Comment.findPublicByPostId` for the shape and order — plus `form`, what a
   * comment form needs to post back: whether comments are open, the signed
   * timestamp, the honeypot's name and how deep replies may go. A form that
   * ignores `form` still works; its comments are held for moderation.
   */
  async byPost(req: Request, res: Response) {
    const postId = parseInt(req.params.postId)

    // The whole thread — the moderation queue and the commenters' addresses —
    // is for moderators. `?all=true` used to unlock it for anyone who asked.
    if (req.query.all === 'true' && can(req.user, 'comment.moderate')) {
      const comments = await Comment.findByPostId(postId, false)
      return res.json({ comments })
    }

    // A draft's comments are as unpublished as the draft.
    if (!(await Post.findPublishedById(postId))) {
      return res.json({ error: 'Post not found' }, 404)
    }

    const comments = await Comment.findPublicByPostId(postId)
    res.json({
      comments,
      form: {
        open: await Settings.getAllowComments(),
        token: issueFormToken(postId),
        honeypot: HONEYPOT_FIELD,
        max_depth: MAX_DEPTH
      }
    })
  },

  async show(req: Request, res: Response) {
    const comment = await Comment.find(parseInt(req.params.id))
    if (!comment) {
      return res.json({ error: 'Comment not found' }, 404)
    }
    res.json({ comment })
  },

  async store(req: Request, res: Response) {
    const postId = parseInt(req.params.postId)

    // Check if comments are allowed
    const allowComments = await Settings.getAllowComments()
    if (!allowComments) {
      return res.json({ error: 'Comments are disabled' }, 403)
    }

    const requiresAuth = !req.userId
    const validationRules: Record<string, unknown[]> = {
      content: [rules.required, rules.string, rules.min(3), rules.max(2000)]
    }

    // If not authenticated, require author info
    if (requiresAuth) {
      validationRules.author_name = [rules.required, rules.string, rules.min(2), rules.max(100)]
      validationRules.author_email = [rules.required, rules.email]
    }

    const result = await validate(req.body, validationRules)

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const body = req.body as Record<string, unknown>
    const { content, author_name, author_email } = body as {
      content: string
      author_name?: string
      author_email?: string
    }
    // A checkbox arrives as true, "true", "on" or "1" depending on the form.
    const notifyReplies = [true, 'true', 'on', '1', 1].includes(body.notify_replies as never)

    // Only a published post takes comments; otherwise anyone could attach text
    // to a draft by guessing its id.
    const post = await Post.findPublishedById(postId)
    if (!post) {
      return res.json({ error: 'Post not found' }, 404)
    }

    // A reply must answer a comment on the same post, or a thread could be
    // stitched together across posts; must answer one readers can see, or a
    // reply could be hung on a pending comment to fish for whether it exists;
    // and must not nest deeper than the page will draw.
    let parent_id: number | undefined
    const requestedParent = body.parent_id
    if (requestedParent !== undefined && requestedParent !== null && requestedParent !== '') {
      const parent = await Comment.find(Number(requestedParent))
      // Not approved gets the same answer as missing, for the reason above.
      if (!parent || Number(parent.post_id) !== postId || parent.status !== 'approved') {
        return res.json({ errors: { parent_id: ['That comment does not exist on this post'] } }, 422)
      }
      if ((await Comment.depthOf(parent)) >= MAX_DEPTH) {
        return res.json({ errors: { parent_id: [`Replies can only nest ${MAX_DEPTH} levels deep`] } }, 422)
      }
      parent_id = Number(parent.id)
    }

    if (req.userId && !can(req.user, 'comment.create')) {
      return res.json({ error: 'You do not have permission to comment.' }, 403)
    }

    // Check if moderation is enabled
    const moderateComments = await Settings.getModerateComments()

    // The spam checks. A moderator is exempt from all of them — they would
    // only be marking their own words as spam to approve again — and any
    // other signed-in commenter skips the bot checks but not the blocklist.
    const ip = clientIp(req)
    const settings = await commentSettings()
    const verdict = can(req.user, 'comment.moderate')
      ? { status: null, reason: null }
      : assess({
        submission: { content, name: author_name, email: author_email, ip },
        honeypot: body[HONEYPOT_FIELD],
        formToken: body.form_token,
        postId,
        blocklist: parseBlocklist(settings.comment_blocklist),
        maxLinks: settings.comment_max_links,
        trusted: !!req.userId
      })

    // Auto-approve if moderation is off or user is logged in — unless a check
    // objected, which always wins.
    const initialStatus: CommentStatus = verdict.status ?? (!moderateComments || !!req.userId ? 'approved' : 'pending')
    const initialApproved = initialStatus === 'approved'

    // A filter, so a spam check can reject a comment or force it into
    // moderation before it is ever stored.
    const creating = await guardWrite(HOOKS.COMMENT_CREATING, {
      post_id: postId,
      user_id: req.userId,
      parent_id,
      author_name: req.userId ? undefined : author_name,
      author_email: req.userId ? undefined : author_email,
      content,
      approved: initialApproved,
      status: initialStatus,
      held_reason: verdict.reason,
      author_ip: ip || null,
      notify_replies: notifyReplies
    }, { req }, { refused: 'Comment rejected.', showErrors: false })

    // A public write: a listener that throws gets a generic refusal, never
    // its own error message.
    if (!creating.ok) return res.json({ error: creating.error }, creating.status)
    const draft = creating.value

    // Listeners written before `status` existed set `approved`. Whichever of
    // the two a listener changed is the one it meant.
    const finalStatus: CommentStatus = isCommentStatus(draft.status) && draft.status !== initialStatus
      ? draft.status
      : Boolean(draft.approved) !== initialApproved
        ? (draft.approved ? 'approved' : 'pending')
        : initialStatus

    const comment = await Comment.create({ ...draft, status: finalStatus })

    await hooks.fire(HOOKS.COMMENT_CREATED, { comment, userId: req.userId })

    // After the row exists and the response is decided; never awaited.
    if (finalStatus === 'pending') {
      inBackground('moderation notice', () => notifyAwaitingModeration(comment, post))
    }
    if (finalStatus === 'approved' && parent_id) {
      inBackground('reply notification', () => notifyParentOfReply(Number(comment.id)))
    }

    res.json({
      comment: submitted(comment),
      message: finalStatus === 'approved' ? 'Comment posted.' : 'Your comment is awaiting moderation.'
    }, 201)
  },

  async update(req: Request, res: Response) {
    const comment = await Comment.find(parseInt(req.params.id))
    if (!comment) {
      return res.json({ error: 'Comment not found' }, 404)
    }

    const result = await validate(req.body, {
      content: [rules.required, rules.string, rules.min(3), rules.max(2000)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { content } = req.body as { content: string }
    const updated = await Comment.update(parseInt(req.params.id), { content })
    res.json({ comment: updated })
  },

  async approve(req: Request, res: Response) {
    const id = parseInt(req.params.id)
    const comment = await Comment.find(id)
    if (!comment) {
      return res.json({ error: 'Comment not found' }, 404)
    }

    const changed = await Comment.setStatus([id], 'approved')
    await afterApproved(changed, req.userId)

    res.json({ comment: await Comment.find(id) })
  },

  /** Move one comment to a status: approve, unapprove, spam, not spam, trash, restore. */
  async setStatus(req: Request, res: Response) {
    const id = parseInt(req.params.id)
    const status = (req.body as { status?: unknown })?.status
    if (!isCommentStatus(status)) {
      return res.json({ errors: { status: [`Must be one of: ${COMMENT_STATUSES.join(', ')}`] } }, 422)
    }

    if (!(await Comment.find(id))) {
      return res.json({ error: 'Comment not found' }, 404)
    }

    const changed = await Comment.setStatus([id], status)
    if (status === 'approved') await afterApproved(changed, req.userId)

    res.json({ comment: await Comment.find(id) })
  },

  /**
   * One action over many comments: `approve`, `pending`, `spam`, `trash` or
   * `delete` (for good). Up to MAX_BULK ids at once.
   */
  async bulk(req: Request, res: Response) {
    const { ids: rawIds, action } = (req.body ?? {}) as { ids?: unknown; action?: unknown }
    const ids = idsFrom(rawIds)
    if (!ids) {
      return res.json({ errors: { ids: [`Give between 1 and ${MAX_BULK} comment ids`] } }, 422)
    }

    if (action === 'delete') {
      let deleted = 0
      for (const id of ids) {
        const comment = await Comment.find(id)
        if (!comment) continue
        await Comment.delete(id)
        await hooks.fire(HOOKS.COMMENT_DELETED, { comment, userId: req.userId })
        deleted++
      }
      return res.json({ affected: deleted })
    }

    const status: CommentStatus | null = action === 'approve' ? 'approved' : isCommentStatus(action) ? action : null
    if (!status) {
      return res.json({ errors: { action: ['Must be one of: approve, pending, spam, trash, delete'] } }, 422)
    }

    const changed = await Comment.setStatus(ids, status)
    if (status === 'approved') await afterApproved(changed, req.userId)

    res.json({ affected: changed.length })
  },

  /** Empty the spam folder or the trash, for good. */
  async empty(req: Request, res: Response) {
    const status = (req.body as { status?: unknown })?.status
    if (status !== 'spam' && status !== 'trash') {
      return res.json({ errors: { status: ['Must be spam or trash'] } }, 422)
    }

    // Not fired per comment: COMMENT_DELETED listeners are for a person's
    // decision about a comment, and a spam folder is thousands of bots.
    const deleted = await Comment.deleteByStatus(status)
    res.json({ affected: deleted })
  },

  /**
   * Delete a comment: to the trash first, then for good.
   *
   * A comment already in the spam or the trash, or a request with
   * `?force=true`, is deleted permanently; anything else is trashed, so one
   * misclick in a moderation queue can be undone.
   */
  async destroy(req: Request, res: Response) {
    const id = parseInt(req.params.id)
    const comment = await Comment.find(id)
    if (!comment) {
      return res.json({ error: 'Comment not found' }, 404)
    }

    const permanent = req.query?.force === 'true' || comment.status === 'trash' || comment.status === 'spam'
    if (!permanent) {
      await Comment.setStatus([id], 'trash')
      return res.json({ message: 'Comment moved to trash', comment: await Comment.find(id) })
    }

    await Comment.delete(id)

    await hooks.fire(HOOKS.COMMENT_DELETED, { comment, userId: req.userId })

    res.json({ message: 'Comment deleted' })
  },

  /**
   * The comment settings this page owns: the blocklist, the link limit and
   * who hears about comments awaiting moderation.
   *
   * Moderators may read them — the blocklist is what explains why a comment
   * was caught — but changing them is site configuration.
   */
  async settings(req: Request, res: Response) {
    res.json({
      settings: await commentSettings(),
      can_manage: can(req.user, 'settings.manage')
    })
  },

  async updateSettings(req: Request, res: Response) {
    const body = (req.body ?? {}) as Record<string, unknown>
    const errors: Record<string, string[]> = {}

    if (body.comment_blocklist !== undefined) {
      if (typeof body.comment_blocklist !== 'string' || body.comment_blocklist.length > MAX_BLOCKLIST_LENGTH) {
        errors.comment_blocklist = [`Must be text of at most ${MAX_BLOCKLIST_LENGTH} characters`]
      }
    }
    if (body.comment_max_links !== undefined) {
      const n = Number(body.comment_max_links)
      if (!Number.isInteger(n) || n < 0 || n > 100) errors.comment_max_links = ['Must be a whole number from 0 to 100']
    }
    if (body.comment_notify !== undefined && !(NOTIFY_AUDIENCES as unknown[]).includes(body.comment_notify)) {
      errors.comment_notify = [`Must be one of: ${NOTIFY_AUDIENCES.join(', ')}`]
    }

    if (Object.keys(errors).length) return res.json({ errors }, 422)

    if (body.comment_blocklist !== undefined) {
      // Settings.get reads an empty value as absent, which is what an empty
      // blocklist means anyway.
      await Settings.set('comment_blocklist', String(body.comment_blocklist), 'discussion')
    }
    if (body.comment_max_links !== undefined) {
      await Settings.set('comment_max_links', Number(body.comment_max_links), 'discussion')
    }
    if (body.comment_notify !== undefined) {
      await Settings.set('comment_notify', String(body.comment_notify), 'discussion')
    }

    res.json({ settings: await commentSettings() })
  },

  /**
   * The unsubscribe link from a reply notification: a confirmation page.
   *
   * GET only shows a button. Mail scanners and link previewers open every
   * link in a message, and a GET that unsubscribed would turn notifications
   * off before the reader saw them.
   */
  async unsubscribePage(req: Request, res: Response) {
    const token = String(req.query?.token ?? '')
    if (!readUnsubscribeToken(token)) {
      return page(res, 400, 'This link is not valid', '<p>It may have been copied incompletely. Nothing has changed.</p>')
    }

    return page(res, 200, 'Stop reply emails?',
      `<p>You will no longer be emailed when someone replies to this comment.</p>
<form method="post" action="/api/comments/unsubscribe?token=${encodeURIComponent(token)}">
<button type="submit" style="background: #111; color: #fff; border: 0; padding: 10px 20px; border-radius: 6px; font-size: 15px; cursor: pointer;">Stop emails</button>
</form>`)
  },

  /**
   * Turn reply emails off for one comment.
   *
   * Also the RFC 8058 one-click target, which a mail client POSTs to with
   * `List-Unsubscribe=One-Click` and reads only the status of. Safe without
   * a session or CSRF token: the signed link is the authority, and the only
   * thing it can do is stop mail.
   */
  async unsubscribe(req: Request, res: Response) {
    const id = readUnsubscribeToken(req.query?.token ?? (req.body as { token?: unknown })?.token)
    if (!id) {
      return page(res, 400, 'This link is not valid', '<p>It may have been copied incompletely. Nothing has changed.</p>')
    }

    // A deleted comment has nothing left to notify about; the answer is the same.
    await Comment.unsubscribe(id)
    return page(res, 200, 'Done', '<p>You will no longer be emailed about replies to this comment.</p>')
  }
}
