import { validate, rules } from '@basicbenframework/core/validation'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { can } from '@basicbenframework/core/auth/permissions'
import { Post } from '../models/Post'
import type { Post as PostType, Request, Response } from '../types'
import { paginationFrom, meta } from '../models/pagination'
import { PostRevision } from '../models/PostRevision'
import { seoFields } from '../helpers/seo-fields'
import { LISTING_FILTERS, type ListingFilter } from '../models/Post'
import { POST_STATUSES, toStoredTimestamp, type PostStatus } from '../models/visibility'
import { lockConflict } from './PostLockController'
import { redirectIfSlugChanged, releasePath } from '../helpers/redirects'
import { postPath } from '../helpers/content-paths'
import { isPostVisibility, POST_VISIBILITIES, withholdBody } from '../helpers/gating'
import { newsletterRefusal } from '../helpers/newsletter'
import { memberFromRequest } from '../middleware/member-auth'
import { typeAndFields, saveTerms, publicPathOf, editorExtras } from '../helpers/content-model'

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
    const query = req.query as Record<string, string | undefined>
    const filter = (LISTING_FILTERS as readonly string[]).includes(query.status ?? '')
      ? (query.status as ListingFilter)
      : 'all'
    const search = query.search?.trim().slice(0, 200) || undefined
    const userId = can(req.user, 'post.edit') ? undefined : req.userId
    // One content type at a time, `post` unless asked: the Posts screen and
    // every client written before content types existed see only posts.
    // `?type=any` lists every type.
    const type = query.type === 'any' ? undefined : (query.type?.trim() || 'post')

    const { posts, total } = await Post.paginate({ perPage, offset, userId, filter, search, type })

    // `posts` stays where it was so nothing reading this breaks; `meta` is
    // added alongside, in the same shape /api/v1 uses. `counts` sizes the
    // status tabs.
    res.json({ posts, meta: meta(page, perPage, total), counts: await Post.counts(userId, type) })
  },

  async show(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || !mayEdit(req, post)) {
      return res.json({ error: 'Post not found' }, 404)
    }

    // The editor needs the current selection to check the right boxes, and a
    // post has many of each now.
    const taxonomy = await Post.taxonomy(post.id)

    // An autosave newer than the post is work the author has not saved —
    // a closed tab, a crash. The editor offers it back rather than losing it.
    const autosave = await PostRevision.pendingAutosave(post.id, req.userId!, String(post.updated_at ?? post.created_at))

    res.json({
      post: { ...post, category_ids: taxonomy.categories, tag_ids: taxonomy.tags, ...(await editorExtras(post)) },
      autosave: autosave ?? null
    })
  },

  async store(req: Request, res: Response) {
    const result = await validate(req.body, {
      title: [rules.required, rules.string, rules.min(3), rules.max(200)],
      content: [rules.required, rules.string, rules.min(10)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const fields = editableFields(req.body)
    if ('errors' in fields) return res.json({ errors: fields.errors }, 422)

    const newsletter = newsletterRefusal(req, fields.values, null)
    if (newsletter) return res.json({ error: newsletter }, 403)
    // Content type and custom fields; see helpers/content-model.ts.
    const typed = await typeAndFields(req.body, null)
    if ('errors' in typed) return res.json({ errors: typed.errors }, 422)
    Object.assign(fields.values, typed.values)

    const publishing = resolvePublishing(req, null)
    if ('error' in publishing) return res.json({ error: publishing.error }, publishing.status)

    const draft = await hooks.filter(HOOKS.POST_CREATING, {
      // Attribution. Anyone may write as themselves; assigning a post to
      // someone else is `post.edit`, the same capability that lets you edit
      // their work — the WordPress rule, where only an editor can hand a post
      // to another author.
      user_id: authorFor(req),
      ...fields.values,
      ...publishing.values
    }, { req })

    // Checked again after the filter, so a listener cannot publish on behalf
    // of someone who may not. Publishing is its own capability: a contributor
    // writes drafts and submits them for review; someone with `post.publish`
    // puts them live.
    if (draft?.published && !can(req.user, 'post.publish')) {
      return res.json({ error: 'You do not have permission to publish posts.' }, 403)
    }

    if (draft?.cancel) {
      return res.json({ error: draft.reason || 'Post rejected.' }, 422)
    }

    const post = await Post.create(draft)

    // A live post on a path an old redirect still claims would never be
    // reached; pages release their path the same way.
    if (post?.published && post.slug) await releasePath(await publicPathOf(post))

    // Categories and tags were accepted by the editor and dropped here — the
    // request carried them, nothing read them, and the selection silently did
    // nothing. They are persisted separately from the post row because both
    // are many-to-many.
    await saveTaxonomy(post.id, req.body)
    await saveTerms(post.id, req.body)

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

    // Once a post is live, changing it is changing the site. A contributor may
    // edit their own drafts and nothing that is published, which is the
    // WordPress rule.
    if (post.published && !can(req.user, 'post.publish')) {
      return res.json({ error: 'You do not have permission to edit a published post.' }, 403)
    }

    if (post.deleted_at) {
      return res.json({ error: 'Restore this post from the trash before editing it.' }, 409)
    }

    // Someone else has it open in the editor; see PostLockController.
    const locked = await lockConflict(req, post)
    if (locked) return res.json(locked, 409)

    const reassigned = authorFor(req, post.user_id)

    const fields = editableFields(req.body)
    if ('errors' in fields) return res.json({ errors: fields.errors }, 422)

    const newsletter = newsletterRefusal(req, fields.values, post)
    if (newsletter) return res.json({ error: newsletter }, 403)
    const typed = await typeAndFields(req.body, post)
    if ('errors' in typed) return res.json({ errors: typed.errors }, 422)
    Object.assign(fields.values, typed.values)

    // Absent means "leave it as it is". Coercing an absent key to 0 turned
    // every request that did not mention publishing into an unpublish.
    const publishing = resolvePublishing(req, post)
    if ('error' in publishing) return res.json({ error: publishing.error }, publishing.status)

    const changes = await hooks.filter(HOOKS.POST_UPDATING, {
      ...fields.values,
      ...(reassigned === post.user_id ? {} : { user_id: reassigned }),
      ...publishing.values
    }, { req, post })

    if (changes?.cancel) {
      return res.json({ error: changes.reason || 'Update rejected.' }, 422)
    }

    if (changes?.published && !can(req.user, 'post.publish')) {
      return res.json({ error: 'You do not have permission to publish posts.' }, 403)
    }

    // What it said before, so this save can be undone.
    await PostRevision.snapshot(post, changes, req.userId ?? null)

    const updated = await Post.update(parseInt(req.params.id), changes)

    // A published post whose slug changed keeps its old URL working (a 301).
    await redirectIfSlugChanged('post', post, updated)

    // A real save supersedes whatever was autosaved while typing it.
    await PostRevision.clearAutosave(post.id, req.userId!)

    await saveTaxonomy(parseInt(req.params.id), req.body)
    await saveTerms(post.id, req.body, updated?.post_type !== post.post_type)

    await hooks.fire(HOOKS.POST_UPDATED, { post: updated, previous: post, userId: req.userId })

    res.json({ post: updated })
  },

  async destroy(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || !mayEdit(req, post)) {
      return res.json({ error: 'Post not found' }, 404)
    }

    // Seeing a post is not the same as being allowed to remove it.
    if (!can(req.user, 'post.delete', post)) {
      return res.json({ error: 'You do not have permission to delete this post.' }, 403)
    }

    // A token may trash, which a person can undo; emptying the trash cannot be
    // undone, so that stays with someone signed in.
    if (req.apiToken && post.deleted_at) {
      return res.json({ error: 'Deleting a post permanently requires a signed-in session.' }, 403)
    }

    const outcome = await removePost(req, post)
    if ('error' in outcome) return res.json({ error: outcome.error }, outcome.status)

    res.json({ message: outcome.message, trashed: outcome.trashed })
  },

  /** Take a post back out of the trash. */
  async restore(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || !mayEdit(req, post)) {
      return res.json({ error: 'Post not found' }, 404)
    }

    const outcome = await restorePost(req, post)
    if ('error' in outcome) return res.json({ error: outcome.error }, outcome.status)

    res.json({ post: await Post.find(post.id) })
  },

  /**
   * One action over many posts: trash, restore, delete, publish, draft.
   *
   * Each post is checked exactly as the single-post endpoint would check it,
   * so selecting forty rows cannot do to one of them what you could not do to
   * it alone. What failed is reported per post rather than failing the batch.
   */
  async bulk(req: Request, res: Response) {
    const { action, ids } = (req.body ?? {}) as { action?: string; ids?: unknown }
    const actions = ['trash', 'restore', 'delete', 'publish', 'draft']

    if (!action || !actions.includes(action) || !Array.isArray(ids) || ids.length === 0) {
      return res.json({ error: `Send an action (${actions.join(', ')}) and a list of ids.` }, 422)
    }

    const unique = [...new Set(ids.map(Number).filter(Number.isInteger))].slice(0, 200)
    const done: number[] = []
    const failed: Array<{ id: number; error: string }> = []

    for (const id of unique) {
      const post = await Post.find(id)
      if (!post || !mayEdit(req, post)) {
        failed.push({ id, error: 'Post not found' })
        continue
      }

      let outcome: { error: string; status: number } | Record<string, unknown>

      if (action === 'trash') {
        outcome = post.deleted_at ? { error: 'Already in the trash', status: 409 } : await removePost(req, post)
      } else if (action === 'delete') {
        outcome = post.deleted_at ? await removePost(req, post) : { error: 'Move it to the trash first', status: 409 }
      } else if (action === 'restore') {
        outcome = await restorePost(req, post)
      } else {
        outcome = await setStatus(req, post, action === 'publish' ? 'published' : 'draft')
      }

      if ('error' in outcome) failed.push({ id, error: String(outcome.error) })
      else done.push(id)
    }

    res.json({ done, failed })
  },

  /** Every saved version of a post, newest first. */
  async revisions(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || !mayEdit(req, post)) {
      return res.json({ error: 'Post not found' }, 404)
    }

    res.json({ revisions: await PostRevision.list(post.id) })
  },

  /** One revision, with its full text, to compare against the post. */
  async revision(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || !mayEdit(req, post)) {
      return res.json({ error: 'Post not found' }, 404)
    }

    const revision = await PostRevision.find(post.id, parseInt(req.params.revisionId))
    if (!revision) return res.json({ error: 'Revision not found' }, 404)

    res.json({ revision })
  },

  /**
   * Put an older version back.
   *
   * A save like any other — it goes through the same capability checks and
   * snapshots the current text first — so restoring is itself undoable.
   */
  async restoreRevision(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || !mayEdit(req, post)) {
      return res.json({ error: 'Post not found' }, 404)
    }

    if (post.published && !can(req.user, 'post.publish')) {
      return res.json({ error: 'You do not have permission to edit a published post.' }, 403)
    }

    const revision = await PostRevision.find(post.id, parseInt(req.params.revisionId))
    if (!revision) return res.json({ error: 'Revision not found' }, 404)

    const locked = await lockConflict(req, post)
    if (locked) return res.json(locked, 409)

    const changes ={ title: revision.title, content: revision.content, excerpt: revision.excerpt ?? '' }

    await PostRevision.snapshot(post, changes, req.userId ?? null)
    const updated = await Post.update(post.id, changes)

    await hooks.fire(HOOKS.POST_UPDATED, { post: updated, previous: post, userId: req.userId })

    res.json({ post: updated })
  },

  /**
   * Keep what is being typed, without saving it.
   *
   * The post is untouched — a live post does not change because its editor
   * paused. The copy waits in the revisions table, one per author, and the
   * editor offers it back if the page is reopened before a real save.
   */
  async autosave(req: Request, res: Response) {
    const post = await Post.find(parseInt(req.params.id))
    if (!post || !mayEdit(req, post)) {
      return res.json({ error: 'Post not found' }, 404)
    }

    const { title, content, excerpt } = (req.body ?? {}) as { title?: unknown; content?: unknown; excerpt?: unknown }
    if (typeof title !== 'string' || typeof content !== 'string') {
      return res.json({ error: 'title and content are required' }, 422)
    }

    // An autosave is harmless to the post, but one from a tab that lost the
    // lock is typing that will be offered back over the new holder's work.
    const locked = await lockConflict(req, post)
    if (locked) return res.json(locked, 409)

    const saved = await PostRevision.autosave(post.id, req.userId!, {
      title: title.slice(0, 200),
      content,
      excerpt: typeof excerpt === 'string' ? excerpt : null
    })

    res.json({ autosave: { id: saved?.id, created_at: saved?.created_at } })
  },

  async feed(req: Request, res: Response) {
    // The built-in blog's feed. Members-only bodies are withheld unless the
    // request carries a member session — see helpers/gating.ts.
    const member = Boolean(await memberFromRequest(req))
    const posts = (await Post.findPublished()).map((post) => withholdBody(post as unknown as Record<string, unknown>, member))
    res.json({ posts })
  },

  async feedShow(req: Request, res: Response) {
    const post = await Post.findPublishedById(parseInt(req.params.id))
    if (!post) {
      return res.json({ error: 'Post not found' }, 404)
    }
    res.json({ post: withholdBody(post as unknown as Record<string, unknown>, Boolean(await memberFromRequest(req))) })
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
  // Through `can()` rather than comparing ids, so the role still counts: an
  // account that lost `post.edit.own` (or never confirmed its address) cannot
  // keep editing posts just because they carry its id.
  return can(req.user, 'post.edit', post)
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
 *
 * Publishing state — `status`, `published`, `publish_at` — is not here; see
 * `resolvePublishing`, which also decides who may change it.
 */
function editableFields(body: unknown):
  | { values: Record<string, unknown> }
  | { errors: Record<string, string[]> } {
  const payload = (body ?? {}) as Record<string, unknown>
  const fields: Record<string, unknown> = {}
  const errors: Record<string, string[]> = {}

  for (const key of ['title', 'content', 'slug', 'excerpt', 'meta_title', 'meta_description']) {
    if (key in payload) fields[key] = payload[key]
  }

  // An id or nothing. The empty string an unset <select> sends would otherwise
  // become a foreign key of '' and fail the write.
  if ('featured_image' in payload) {
    const id = Number(payload.featured_image)
    fields.featured_image = Number.isInteger(id) && id > 0 ? id : null
  }

  const seo = seoFields(payload)
  if ('errors' in seo) Object.assign(errors, seo.errors)
  else Object.assign(fields, seo.values)

  // Who may read the body, and the request to email it (permission for the
  // latter is `newsletterRefusal`, which needs the request).
  if ('visibility' in payload) {
    if (isPostVisibility(payload.visibility)) fields.visibility = payload.visibility
    else errors.visibility = [`Must be one of ${POST_VISIBILITIES.join(', ')}`]
  }
  if ('send_newsletter' in payload) fields.send_newsletter = payload.send_newsletter ? 1 : 0

  return Object.keys(errors).length ? { errors } : { values: fields }
}

/**
 * Work out the publishing state a request asks for, and whether it may.
 *
 * Accepts `status` (`draft`, `pending`, `published`) and, for clients written
 * before it existed, the old `published` boolean. `publish_at` in the future
 * on a published post is a schedule: the post is stored as published and the
 * public site starts showing it when the time comes.
 *
 * `existing` is null on create. On update, absent keys leave the state alone.
 */
function resolvePublishing(
  req: Request,
  existing: PostType | null
): { values: Record<string, unknown> } | { error: string; status: number } {
  const body = (req.body ?? {}) as { status?: unknown; published?: unknown; publish_at?: unknown }

  let status: PostStatus | undefined
  if (typeof body.status === 'string') {
    if (!(POST_STATUSES as readonly string[]).includes(body.status)) {
      return { error: `status must be one of ${POST_STATUSES.join(', ')}`, status: 422 }
    }
    status = body.status as PostStatus
  } else if (body.published !== undefined) {
    status = body.published ? 'published' : 'draft'
  }

  let publishAt: string | null | undefined
  if ('publish_at' in body) {
    try {
      publishAt = toStoredTimestamp(body.publish_at)
    } catch {
      return { error: 'publish_at is not a valid date', status: 422 }
    }
  }

  const values: Record<string, unknown> = {}
  const wasPublished = Boolean(existing?.published)
  const finalStatus = status ?? (existing ? undefined : 'draft')

  if (finalStatus === 'published' && !wasPublished && !can(req.user, 'post.publish')) {
    return { error: 'You do not have permission to publish posts.', status: 403 }
  }

  if (finalStatus !== undefined) {
    values.status = finalStatus
    values.published = finalStatus === 'published' ? 1 : 0
  }

  if (publishAt !== undefined) values.publish_at = publishAt

  // Going live with no date given means now. A post that was already live
  // keeps the date it went live, so republishing does not reorder the blog.
  const goingLive = finalStatus === 'published' && !wasPublished
  if (goingLive && !values.publish_at) values.publish_at = new Date().toISOString()

  // Webhooks hear about a live post when it is saved; a scheduled one is told
  // by the publish-due tick when its time arrives.
  const effectiveStatus = finalStatus ?? (wasPublished ? 'published' : existing?.status)
  const effectiveAt = (values.publish_at ?? existing?.publish_at ?? null) as string | null
  if (effectiveStatus === 'published' && (goingLive || 'publish_at' in values)) {
    values.live_notified = effectiveAt && new Date(effectiveAt).getTime() > Date.now() ? 0 : 1
  }

  return { values }
}

/** Trash a post, or delete it for good if it is already in the trash. */
async function removePost(
  req: Request,
  post: PostType
): Promise<{ message: string; trashed: boolean } | { error: string; status: number }> {
  // Seeing a post is not the same as being allowed to remove it.
  if (!can(req.user, 'post.delete', post)) {
    return { error: 'You do not have permission to delete this post.', status: 403 }
  }

  const permanent = Boolean(post.deleted_at)

  const intent = await hooks.filter(HOOKS.POST_DELETING, { post, cancel: false, permanent }, { req })
  if (intent?.cancel) {
    return { error: intent.reason || 'Deletion rejected.', status: 422 }
  }

  if (permanent) {
    await Post.delete(post.id)
  } else {
    await Post.trash(post.id)
  }

  // Fired on trashing: that is when the post leaves the public site, which is
  // what a webhook consumer needs to hear.
  await hooks.fire(HOOKS.POST_DELETED, { post, userId: req.userId, permanent })

  return permanent
    ? { message: 'Post deleted permanently', trashed: false }
    : { message: 'Post moved to the trash', trashed: true }
}

async function restorePost(req: Request, post: PostType): Promise<{ ok: true } | { error: string; status: number }> {
  if (!post.deleted_at) return { error: 'This post is not in the trash.', status: 409 }
  if (!can(req.user, 'post.delete', post)) {
    return { error: 'You do not have permission to restore this post.', status: 403 }
  }

  await Post.restore(post.id)
  const restored = await Post.find(post.id)
  await hooks.fire(HOOKS.POST_UPDATED, { post: restored, previous: post, userId: req.userId })
  return { ok: true }
}

/** Publish or unpublish one post, for bulk actions. */
async function setStatus(
  req: Request,
  post: PostType,
  status: PostStatus
): Promise<{ ok: true } | { error: string; status: number }> {
  if (post.deleted_at) return { error: 'Restore it from the trash first.', status: 409 }
  if (!can(req.user, 'post.publish')) {
    return { error: 'You do not have permission to publish posts.', status: 403 }
  }

  const original = req.body
  ;(req as { body: unknown }).body = { status }
  const publishing = resolvePublishing(req, post)
  ;(req as { body: unknown }).body = original
  if ('error' in publishing) return publishing

  const updated = await Post.update(post.id, publishing.values)
  await hooks.fire(HOOKS.POST_UPDATED, { post: updated, previous: post, userId: req.userId })
  return { ok: true }
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
