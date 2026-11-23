import { validate, rules } from '@basicbenframework/core/validation'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { Comment } from '../models/Comment'
import { Settings } from '../models/Settings'
import { Post } from '../models/Post'
import { can } from '@basicbenframework/core/auth/permissions'
import type { Request, Response } from '../types'

export const CommentController = {
  async index(req: Request, res: Response) {
    const comments = await Comment.all()
    res.json({ comments })
  },

  async pending(req: Request, res: Response) {
    const comments = await Comment.findPending()
    const count = await Comment.countPending()
    res.json({ comments, count })
  },

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
    res.json({ comments })
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

    const { content, author_name, author_email } = req.body as {
      content: string
      author_name?: string
      author_email?: string
    }

    // Only a published post takes comments; otherwise anyone could attach text
    // to a draft by guessing its id.
    if (!(await Post.findPublishedById(postId))) {
      return res.json({ error: 'Post not found' }, 404)
    }

    // A reply must answer a comment on the same post, or a thread could be
    // stitched together across posts.
    let parent_id: number | undefined
    const requestedParent = (req.body as { parent_id?: unknown }).parent_id
    if (requestedParent !== undefined && requestedParent !== null && requestedParent !== '') {
      const parent = await Comment.find(Number(requestedParent))
      if (!parent || Number(parent.post_id) !== postId) {
        return res.json({ errors: { parent_id: ['That comment does not exist on this post'] } }, 422)
      }
      parent_id = Number(parent.id)
    }

    if (req.userId && !can(req.user, 'comment.create')) {
      return res.json({ error: 'You do not have permission to comment.' }, 403)
    }

    // Check if moderation is enabled
    const moderateComments = await Settings.getModerateComments()

    // A filter, so a spam check can reject a comment or force it into
    // moderation before it is ever stored.
    const draft = await hooks.filter(HOOKS.COMMENT_CREATING, {
      post_id: postId,
      user_id: req.userId,
      parent_id,
      author_name: req.userId ? undefined : author_name,
      author_email: req.userId ? undefined : author_email,
      content,
      approved: !moderateComments || !!req.userId // Auto-approve if moderation is off or user is logged in
    }, { req })

    if (draft?.cancel) {
      return res.json({ error: draft.reason || 'Comment rejected.' }, 422)
    }

    const comment = await Comment.create(draft)

    await hooks.fire(HOOKS.COMMENT_CREATED, { comment, userId: req.userId })

    res.json({ comment }, 201)
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
    const comment = await Comment.find(parseInt(req.params.id))
    if (!comment) {
      return res.json({ error: 'Comment not found' }, 404)
    }

    const approved = await Comment.approve(parseInt(req.params.id))

    await hooks.fire(HOOKS.COMMENT_APPROVED, { comment: approved, userId: req.userId })

    res.json({ comment: approved })
  },

  async destroy(req: Request, res: Response) {
    const comment = await Comment.find(parseInt(req.params.id))
    if (!comment) {
      return res.json({ error: 'Comment not found' }, 404)
    }

    await Comment.delete(parseInt(req.params.id))

    await hooks.fire(HOOKS.COMMENT_DELETED, { comment, userId: req.userId })

    res.json({ message: 'Comment deleted' })
  }
}
