import { validate, rules } from '@basicbenframework/core/validation'
import { Tag } from '../models/Tag'
import type { Request, Response } from '../types'

export const TagController = {
  async index(req: Request, res: Response) {
    const tags = await Tag.all()
    res.json({ tags })
  },

  async show(req: Request, res: Response) {
    const tag = await Tag.find(parseInt(req.params.id))
    if (!tag) {
      return res.json({ error: 'Tag not found' }, 404)
    }
    res.json({ tag })
  },

  async showBySlug(req: Request, res: Response) {
    const tag = await Tag.findBySlug(req.params.slug)
    if (!tag) {
      return res.json({ error: 'Tag not found' }, 404)
    }
    res.json({ tag })
  },

  async store(req: Request, res: Response) {
    const result = await validate(req.body, {
      name: [rules.required, rules.string, rules.min(2), rules.max(50)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { name, slug } = req.body as { name: string; slug?: string }

    // Check for slug uniqueness if provided
    if (slug) {
      const exists = await Tag.slugExists(slug)
      if (exists) {
        return res.json({ errors: { slug: ['Slug already exists'] } }, 422)
      }
    }

    const tag = await Tag.create({ name, slug })
    res.json({ tag }, 201)
  },

  async update(req: Request, res: Response) {
    const tag = await Tag.find(parseInt(req.params.id))
    if (!tag) {
      return res.json({ error: 'Tag not found' }, 404)
    }

    const result = await validate(req.body, {
      name: [rules.required, rules.string, rules.min(2), rules.max(50)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { name, slug } = req.body as { name: string; slug?: string }

    // Check for slug uniqueness if changed
    if (slug && slug !== tag.slug) {
      const exists = await Tag.slugExists(slug, tag.id)
      if (exists) {
        return res.json({ errors: { slug: ['Slug already exists'] } }, 422)
      }
    }

    const updated = await Tag.update(parseInt(req.params.id), { name, slug })
    res.json({ tag: updated })
  },

  async destroy(req: Request, res: Response) {
    const tag = await Tag.find(parseInt(req.params.id))
    if (!tag) {
      return res.json({ error: 'Tag not found' }, 404)
    }

    await Tag.delete(parseInt(req.params.id))
    res.json({ message: 'Tag deleted' })
  }
}
