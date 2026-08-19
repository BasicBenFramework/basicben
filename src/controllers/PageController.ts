import { validate, rules } from '@basicbenframework/core/validation'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { Page } from '../models/Page'
import type { Request, Response } from '../types'
import { paginationFrom, meta } from '../models/pagination'

export const PageController = {
  async index(req: Request, res: Response) {
    const { page, perPage, offset } = paginationFrom(req.query as Record<string, string>)
    const { pages, total } = await Page.paginate({ perPage, offset })

    res.json({ pages, meta: meta(page, perPage, total) })
  },

  async tree(req: Request, res: Response) {
    const pages = await Page.tree()
    res.json({ pages })
  },

  async published(req: Request, res: Response) {
    const pages = await Page.findPublished()
    res.json({ pages })
  },

  async show(req: Request, res: Response) {
    const page = await Page.find(parseInt(req.params.id))
    if (!page) {
      return res.json({ error: 'Page not found' }, 404)
    }
    res.json({ page })
  },

  async showBySlug(req: Request, res: Response) {
    const page = await Page.findBySlug(req.params.slug)
    if (!page) {
      return res.json({ error: 'Page not found' }, 404)
    }
    res.json({ page })
  },

  async showPublishedBySlug(req: Request, res: Response) {
    const page = await Page.findPublishedBySlug(req.params.slug)
    if (!page) {
      return res.json({ error: 'Page not found' }, 404)
    }
    res.json({ page })
  },

  async store(req: Request, res: Response) {
    const result = await validate(req.body, {
      title: [rules.required, rules.string, rules.min(2), rules.max(200)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const {
      title,
      slug,
      content,
      featured_image,
      template,
      published,
      parent_id,
      menu_order,
      meta_title,
      meta_description
    } = req.body as {
      title: string
      slug?: string
      content?: string
      featured_image?: number | null
      template?: string
      published?: boolean
      parent_id?: number
      menu_order?: number
      meta_title?: string
      meta_description?: string
    }

    // Check for slug uniqueness if provided
    if (slug) {
      const exists = await Page.slugExists(slug)
      if (exists) {
        return res.json({ errors: { slug: ['Slug already exists'] } }, 422)
      }
    }

    const draft = await hooks.filter(HOOKS.PAGE_CREATING, {
      title,
      slug,
      content,
      // A page can carry a hero image now, the way a post always could. It
      // arrives as a media id; an unset picker sends nothing rather than ''.
      featured_image: mediaId(featured_image),
      template,
      published,
      parent_id,
      menu_order,
      meta_title,
      meta_description
    }, { req })

    if (draft?.cancel) {
      return res.json({ error: draft.reason || 'Page rejected.' }, 422)
    }

    const page = await Page.create(draft)

    await hooks.fire(HOOKS.PAGE_CREATED, { page, userId: req.userId })

    res.json({ page }, 201)
  },

  async update(req: Request, res: Response) {
    const page = await Page.find(parseInt(req.params.id))
    if (!page) {
      return res.json({ error: 'Page not found' }, 404)
    }

    const result = await validate(req.body, {
      title: [rules.required, rules.string, rules.min(2), rules.max(200)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const {
      title,
      slug,
      content,
      featured_image,
      template,
      published,
      parent_id,
      menu_order,
      meta_title,
      meta_description
    } = req.body as {
      title: string
      slug?: string
      content?: string
      featured_image?: number | null
      template?: string
      published?: boolean
      parent_id?: number
      menu_order?: number
      meta_title?: string
      meta_description?: string
    }

    // Check for slug uniqueness if changed
    if (slug && slug !== page.slug) {
      const exists = await Page.slugExists(slug, page.id)
      if (exists) {
        return res.json({ errors: { slug: ['Slug already exists'] } }, 422)
      }
    }

    // Prevent setting parent to self
    if (parent_id === page.id) {
      return res.json({ errors: { parent_id: ['Cannot set page as its own parent'] } }, 422)
    }

    const changes = await hooks.filter(HOOKS.PAGE_UPDATING, {
      title,
      slug,
      content,
      // Only when the request mentioned it. Sending null unconditionally would
      // mean any client that does not know about featured images strips the one
      // a page already has.
      ...('featured_image' in req.body ? { featured_image: mediaId(featured_image) } : {}),
      template,
      published,
      parent_id,
      menu_order,
      meta_title,
      meta_description
    }, { req, page })

    if (changes?.cancel) {
      return res.json({ error: changes.reason || 'Update rejected.' }, 422)
    }

    const updated = await Page.update(parseInt(req.params.id), changes)

    await hooks.fire(HOOKS.PAGE_UPDATED, { page: updated, previous: page, userId: req.userId })

    res.json({ page: updated })
  },

  async destroy(req: Request, res: Response) {
    const page = await Page.find(parseInt(req.params.id))
    if (!page) {
      return res.json({ error: 'Page not found' }, 404)
    }

    // A deleted page is exactly what a rebuild needs to know about, and until
    // page.deleted existed it was the one content change that notified nothing.
    const intent = await hooks.filter(HOOKS.PAGE_DELETING, { page, cancel: false }, { req })

    if (intent?.cancel) {
      return res.json({ error: intent.reason || 'Deletion rejected.' }, 422)
    }

    await Page.delete(parseInt(req.params.id))

    await hooks.fire(HOOKS.CONTENT_DELETE, { type: 'page', page, userId: req.userId })
    await hooks.fire(HOOKS.PAGE_DELETED, { page, userId: req.userId })

    res.json({ message: 'Page deleted' })
  },

  async reorder(req: Request, res: Response) {
    const { pages } = req.body as { pages: { id: number; menu_order: number }[] }

    if (!pages || !Array.isArray(pages)) {
      return res.json({ errors: { pages: ['Pages array is required'] } }, 422)
    }

    await Page.reorder(pages)
    res.json({ message: 'Pages reordered' })
  }
}

/**
 * A media id, or nothing.
 *
 * The picker clears itself by sending null, and an empty <select> sends the
 * empty string — which would be written as a foreign key of '' and fail on
 * Postgres rather than mean "no image".
 */
function mediaId(value: number | null | undefined): number | null {
  const id = Number(value)

  return Number.isInteger(id) && id > 0 ? id : null
}
