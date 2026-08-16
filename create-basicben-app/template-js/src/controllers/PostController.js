import { validate, rules } from '@basicbenframework/core/validation'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { Post } from '../models/Post.js'

/**
 * Hooks fire from here so plugins can take part in the content lifecycle.
 *
 * `*.creating` and `*.updating` are filters — a plugin returns the data,
 * possibly changed, or `{ cancel: true }` to refuse the write. `*.created`
 * and `*.updated` are notifications; their return value is ignored.
 */

export const PostController = {
  async index(req, res) {
    const posts = await Post.findByUser(req.userId)
    res.json({ posts })
  },

  async show(req, res) {
    const post = await Post.find(req.params.id)
    if (!post || post.user_id !== req.userId) {
      return res.json({ error: 'Post not found' }, 404)
    }
    res.json({ post })
  },

  async store(req, res) {
    const result = await validate(req.body, {
      title: [rules.required, rules.string, rules.min(3), rules.max(200)],
      content: [rules.required, rules.string, rules.min(10)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { title, content, published } = req.body

    const draft = await hooks.filter(HOOKS.POST_CREATING, {
      user_id: req.userId,
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

  async update(req, res) {
    const post = await Post.find(req.params.id)
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

    const { title, content, published } = req.body

    const changes = await hooks.filter(HOOKS.POST_UPDATING, {
      title,
      content,
      published: published ? 1 : 0
    }, { req, post })

    if (changes?.cancel) {
      return res.json({ error: changes.reason || 'Update rejected.' }, 422)
    }

    const updated = await Post.update(req.params.id, changes)

    await hooks.fire(HOOKS.POST_UPDATED, { post: updated, previous: post, userId: req.userId })

    res.json({ post: updated })
  },

  async destroy(req, res) {
    const post = await Post.find(req.params.id)
    if (!post || post.user_id !== req.userId) {
      return res.json({ error: 'Post not found' }, 404)
    }

    const intent = await hooks.filter(HOOKS.POST_DELETING, { post, cancel: false }, { req })

    if (intent?.cancel) {
      return res.json({ error: intent.reason || 'Deletion rejected.' }, 422)
    }

    await Post.delete(req.params.id)

    await hooks.fire(HOOKS.POST_DELETED, { post, userId: req.userId })

    res.json({ message: 'Post deleted' })
  },

  async feed(req, res) {
    const posts = await Post.findPublished()
    res.json({ posts })
  },

  async feedShow(req, res) {
    const post = await Post.findPublishedById(req.params.id)
    if (!post) {
      return res.json({ error: 'Post not found' }, 404)
    }
    res.json({ post })
  }
}
