import { validate, rules } from '@basicbenframework/core/validation'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { Post } from '../models/Post'
import type { Request, Response } from '../types'
import { paginationFrom, meta } from '../models/pagination'

/**
 * Hooks fire from here so an app can take part in the content lifecycle.
 *
 * The `*.creating` and `*.updating` hooks are **filters**: a listener receives
 * the data and returns it, possibly changed, or returns `{ cancel: true }` to
 * refuse the write. The `*.created`, `*.updated` and `*.deleted` hooks are
 * notifications — the write has happened and their return value is ignored.
 *
 * These live in the controller rather than the model because models here are
 * hand-written plain objects with no base class to hang a lifecycle on. The
 * cost is that an app which rewrites a controller has to keep the calls.
 */
export const PostController = {
  async index(req: Request, res: Response) {
    const { page, perPage, offset } = paginationFrom(req.query as Record<string, string>)
    const { posts, total } = await Post.pageByUser(req.userId!, { perPage, offset })

    // `posts` stays where it was so nothing reading this breaks; `meta` is
    // added alongside, in the same shape /api/v1 uses.
    res.json({ posts, meta: meta(page, perPage, total) })
  },

  async show(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || post.user_id !== req.userId) {
      return res.json({ error: 'Post not found' }, 404)
    }
    res.json({ post })
  },

  async store(req: Request, res: Response) {
    const result = await validate(req.body, {
      title: [rules.required, rules.string, rules.min(3), rules.max(200)],
      content: [rules.required, rules.string, rules.min(10)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { title, content, published } = req.body as { title: string; content: string; published?: boolean }

    const draft = await hooks.filter(HOOKS.POST_CREATING, {
      user_id: req.userId!,
      title,
      content,
      published: published || false
    }, { req })

    if (draft?.cancel) {
      return res.json({ error: draft.reason || 'Post rejected.' }, 422)
    }

    const post = await Post.create(draft)

    await hooks.fire(HOOKS.POST_CREATED, { post, userId: req.userId })

    res.json({ post }, 201)
  },

  async update(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || post.user_id !== req.userId) {
      return res.json({ error: 'Post not found' }, 404)
    }

    const result = await validate(req.body, {
      title: [rules.required, rules.string, rules.min(3), rules.max(200)],
      content: [rules.required, rules.string, rules.min(10)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { title, content, published } = req.body as { title: string; content: string; published?: boolean }

    const changes = await hooks.filter(HOOKS.POST_UPDATING, {
      title,
      content,
      published: published ? 1 : 0
    }, { req, post })

    if (changes?.cancel) {
      return res.json({ error: changes.reason || 'Update rejected.' }, 422)
    }

    const updated = await Post.update(parseInt(req.params.id), changes)

    await hooks.fire(HOOKS.POST_UPDATED, { post: updated, previous: post, userId: req.userId })

    res.json({ post: updated })
  },

  async destroy(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || post.user_id !== req.userId) {
      return res.json({ error: 'Post not found' }, 404)
    }

    const intent = await hooks.filter(HOOKS.POST_DELETING, { post, cancel: false }, { req })

    if (intent?.cancel) {
      return res.json({ error: intent.reason || 'Deletion rejected.' }, 422)
    }

    await Post.delete(parseInt(req.params.id))

    await hooks.fire(HOOKS.POST_DELETED, { post, userId: req.userId })

    res.json({ message: 'Post deleted' })
  },

  async feed(req: Request, res: Response) {
    const posts = await Post.findPublished()
    res.json({ posts })
  },

  async feedShow(req: Request, res: Response) {
    const post = await Post.findPublishedById(parseInt(req.params.id))
    if (!post) {
      return res.json({ error: 'Post not found' }, 404)
    }
    res.json({ post })
  }
}
