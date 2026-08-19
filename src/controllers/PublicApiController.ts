import {
  PublicContent,
  paging,
  contentFormat
} from '../models/PublicContent'
import type { Request, Response } from '../types'

/**
 * The read-only content API, mounted at /api/v1.
 *
 * Versioned where the admin API is not, because this one has consumers the site
 * does not control — a static build, someone's app — and breaking them silently
 * on a Tuesday is exactly what a version prefix exists to prevent.
 *
 * Everything here is a read. There is no v1 write surface: the admin API
 * already has one, gated on roles, and a second path to the same mutations is a
 * second place for an authorization bug to live.
 */
export const PublicApiController = {
  async posts(req: Request, res: Response) {
    const { page, perPage, offset } = paging(req.query)

    const { posts, total } = await PublicContent.posts({
      perPage,
      offset,
      category: req.query.category,
      tag: req.query.tag,
      author: req.query.author,
      search: req.query.search,
      format: contentFormat(req.query)
    })

    res.json({
      data: posts,
      meta: {
        page,
        per_page: perPage,
        total,
        // Computed rather than left to the consumer: total/per_page is the sum
        // people get wrong, and an off-by-one here means a paginating client
        // either misses the last page or loops forever on an empty one.
        total_pages: Math.max(1, Math.ceil(total / perPage))
      }
    })
  },

  async post(req: Request, res: Response) {
    const post = await PublicContent.post(req.params.slug, contentFormat(req.query))

    if (!post) {
      return res.json({ error: 'Not found' }, 404)
    }

    res.json({ data: post })
  },

  async pages(req: Request, res: Response) {
    const { page, perPage, offset } = paging(req.query)

    const { pages, total } = await PublicContent.pages({
      perPage,
      offset,
      format: contentFormat(req.query)
    })

    res.json({
      data: pages,
      meta: { page, per_page: perPage, total, total_pages: Math.max(1, Math.ceil(total / perPage)) }
    })
  },

  async page(req: Request, res: Response) {
    const found = await PublicContent.page(req.params.slug, contentFormat(req.query))

    if (!found) {
      return res.json({ error: 'Not found' }, 404)
    }

    res.json({ data: found })
  },

  async authors(_req: Request, res: Response) {
    res.json({ data: await PublicContent.authors() })
  },

  async author(req: Request, res: Response) {
    const found = await PublicContent.author(req.params.slug)

    if (!found) {
      return res.json({ error: 'Not found' }, 404)
    }

    res.json({ data: found })
  },

  async categories(_req: Request, res: Response) {
    res.json({ data: await PublicContent.categories() })
  },

  async tags(_req: Request, res: Response) {
    res.json({ data: await PublicContent.tags() })
  },

  async media(req: Request, res: Response) {
    const id = Number(req.params.id)

    if (!Number.isInteger(id)) {
      return res.json({ error: 'Not found' }, 404)
    }

    const item = await PublicContent.media(id)

    if (!item) {
      return res.json({ error: 'Not found' }, 404)
    }

    res.json({ data: item })
  }
}
