import { validate, rules } from '@basicbenframework/core/validation'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { Page } from '../models/Page'
import type { Request, Response } from '../types'

export const PageController = {
  async index(req: Request, res: Response) {
    const pages = await Page.all()
    res.json({ pages })
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

    await Page.delete(parseInt(req.params.id))

    await hooks.fire(HOOKS.CONTENT_DELETE, { type: 'page', page, userId: req.userId })

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
