import { validate, rules } from '@basicbenframework/core/validation'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { can } from '@basicbenframework/core/auth/permissions'
import { Post } from '../models/Post'
import type { Post as PostType, Request, Response } from '../types'
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

    // An editor or an admin sees the whole site; an author sees their own work.
    // The listing was scoped to the signed-in user unconditionally, so the
    // people with `post.edit` — the ones responsible for everyone else's posts
    // — could not see a single one of them.
    const { posts, total } = await Post.paginate({
      perPage,
      offset,
      userId: can(req.user, 'post.edit') ? undefined : req.userId
    })

    // `posts` stays where it was so nothing reading this breaks; `meta` is
    // added alongside, in the same shape /api/v1 uses.
    res.json({ posts, meta: meta(page, perPage, total) })
  },

  async show(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || !mayEdit(req, post)) {
      return res.json({ error: 'Post not found' }, 404)
    }

    // The editor needs the current selection to check the right boxes, and a
    // post has many of each now.
    const taxonomy = await Post.taxonomy(post.id)

    res.json({ post: { ...post, category_ids: taxonomy.categories, tag_ids: taxonomy.tags } })
  },

  async store(req: Request, res: Response) {
    const result = await validate(req.body, {
      title: [rules.required, rules.string, rules.min(3), rules.max(200)],
      content: [rules.required, rules.string, rules.min(10)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const draft = await hooks.filter(HOOKS.POST_CREATING, {
      // Attribution. Anyone may write as themselves; assigning a post to
      // someone else is `post.edit`, the same capability that lets you edit
      // their work — the WordPress rule, where only an editor can hand a post
      // to another author.
      user_id: authorFor(req),
      ...editableFields(req.body),
      published: Boolean((req.body as { published?: boolean }).published)
    }, { req })

    if (draft?.cancel) {
      return res.json({ error: draft.reason || 'Post rejected.' }, 422)
    }

    const post = await Post.create(draft)

    // Categories and tags were accepted by the editor and dropped here — the
    // request carried them, nothing read them, and the selection silently did
    // nothing. They are persisted separately from the post row because both
    // are many-to-many.
    await saveTaxonomy(post.id, req.body)

    await hooks.fire(HOOKS.POST_CREATED, { post, userId: req.userId })

    res.json({ post }, 201)
  },

  async update(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || !mayEdit(req, post)) {
      return res.json({ error: 'Post not found' }, 404)
    }

    const result = await validate(req.body, {
      title: [rules.required, rules.string, rules.min(3), rules.max(200)],
      content: [rules.required, rules.string, rules.min(10)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const reassigned = authorFor(req, post.user_id)

    const published = (req.body as { published?: boolean }).published

    const changes = await hooks.filter(HOOKS.POST_UPDATING, {
      ...editableFields(req.body),
      ...(reassigned === post.user_id ? {} : { user_id: reassigned }),
      // Absent means "leave it as it is". Coercing an absent key to 0 turned
      // every request that did not mention publishing into an unpublish.
      ...(published === undefined ? {} : { published: published ? 1 : 0 })
    }, { req, post })

    if (changes?.cancel) {
      return res.json({ error: changes.reason || 'Update rejected.' }, 422)
    }

    const updated = await Post.update(parseInt(req.params.id), changes)

    await saveTaxonomy(parseInt(req.params.id), req.body)

    await hooks.fire(HOOKS.POST_UPDATED, { post: updated, previous: post, userId: req.userId })

    res.json({ post: updated })
  },

  async destroy(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || !mayEdit(req, post)) {
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

/**
 * May this request act on this post?
 *
 * Its author always may, which is what every check here used to test on its
 * own. `post.edit` is the capability for everyone else's work, so an editor and
 * an admin stop getting "Post not found" for a post that plainly exists.
 */
function mayEdit(req: Request, post: PostType): boolean {
  return post.user_id === req.userId || can(req.user, 'post.edit')
}

/**
 * Who the post belongs to.
 *
 * A `user_id` in the body is honoured only for a caller who can edit anyone's
 * posts; for everyone else it is ignored rather than refused, because a body
 * that carries the author it already had should not fail a save.
 */
function authorFor(req: Request, fallback?: number): number {
  const requested = Number((req.body as { user_id?: unknown }).user_id)
  const current = fallback ?? req.userId!

  if (!Number.isInteger(requested) || requested === current) return current

  return can(req.user, 'post.edit') ? requested : current
}

/**
 * The fields the editor sends and the post row stores.
 *
 * Everything but title, content and published used to be dropped here: the SEO
 * panel, the excerpt and the featured image were all accepted by the API and
 * written nowhere. Absent keys stay absent so a caller changing one field does
 * not blank the rest; a blank slug or excerpt is a request to derive one, which
 * the model does.
 */
function editableFields(body: unknown): Record<string, unknown> {
  const payload = (body ?? {}) as Record<string, unknown>
  const fields: Record<string, unknown> = {}

  for (const key of ['title', 'content', 'slug', 'excerpt', 'meta_title', 'meta_description', 'publish_at']) {
    if (key in payload) fields[key] = payload[key]
  }

  // An id or nothing. The empty string an unset <select> sends would otherwise
  // become a foreign key of '' and fail the write.
  if ('featured_image' in payload) {
    const id = Number(payload.featured_image)
    fields.featured_image = Number.isInteger(id) && id > 0 ? id : null
  }

  return fields
}

/**
 * Persist the category and tag selection that comes with a post.
 *
 * Absent keys leave the existing selection alone, so a caller that only wants
 * to change a title does not have to resend the taxonomy to keep it. An empty
 * array is a real instruction and clears it.
 */
async function saveTaxonomy(postId: number, body: unknown) {
  const payload = (body ?? {}) as { category_ids?: unknown; tags?: unknown; tag_ids?: unknown }

  if (Array.isArray(payload.category_ids)) {
    await Post.syncCategories(postId, payload.category_ids as number[])
  }

  // The editor has always called this one `tags`; `tag_ids` is accepted too so
  // the two halves of the pair are named alike from outside.
  const tags = Array.isArray(payload.tag_ids) ? payload.tag_ids : payload.tags

  if (Array.isArray(tags)) {
    await Post.syncTags(postId, tags as number[])
  }
}
