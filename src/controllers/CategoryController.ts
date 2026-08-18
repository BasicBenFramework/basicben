import { validate, rules } from '@basicbenframework/core/validation'
import { Category } from '../models/Category'
import type { Request, Response } from '../types'

export const CategoryController = {
  async index(req: Request, res: Response) {
    const categories = await Category.all()
    res.json({ categories })
  },

  async tree(req: Request, res: Response) {
    const categories = await Category.tree()
    res.json({ categories })
  },

  async show(req: Request, res: Response) {
    const category = await Category.find(parseInt(req.params.id))
    if (!category) {
      return res.json({ error: 'Category not found' }, 404)
    }
    res.json({ category })
  },

  async showBySlug(req: Request, res: Response) {
    const category = await Category.findBySlug(req.params.slug)
    if (!category) {
      return res.json({ error: 'Category not found' }, 404)
    }
    res.json({ category })
  },

  async store(req: Request, res: Response) {
    const result = await validate(req.body, {
      name: [rules.required, rules.string, rules.min(2), rules.max(100)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { name, slug, description, parent_id } = req.body as {
      name: string
      slug?: string
      description?: string
      parent_id?: number
    }

    // Check for slug uniqueness if provided
    if (slug) {
      const exists = await Category.slugExists(slug)
      if (exists) {
        return res.json({ errors: { slug: ['Slug already exists'] } }, 422)
      }
    }

    const category = await Category.create({
      name,
      slug: slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      description,
      parent_id
    })

    res.json({ category }, 201)
  },

  async update(req: Request, res: Response) {
    const category = await Category.find(parseInt(req.params.id))
    if (!category) {
      return res.json({ error: 'Category not found' }, 404)
    }

    const result = await validate(req.body, {
      name: [rules.required, rules.string, rules.min(2), rules.max(100)]
    })

    if (result.fails()) {
      return res.json({ errors: result.errors }, 422)
    }

    const { name, slug, description, parent_id } = req.body as {
      name: string
      slug?: string
      description?: string
      parent_id?: number
    }

    // Check for slug uniqueness if changed
    if (slug && slug !== category.slug) {
      const exists = await Category.slugExists(slug, category.id)
      if (exists) {
        return res.json({ errors: { slug: ['Slug already exists'] } }, 422)
      }
    }

    // Prevent setting parent to self or to a child
    if (parent_id === category.id) {
      return res.json({ errors: { parent_id: ['Cannot set category as its own parent'] } }, 422)
    }

    const updated = await Category.update(parseInt(req.params.id), {
      name,
      slug,
      description,
      parent_id
    })

    res.json({ category: updated })
  },

  async destroy(req: Request, res: Response) {
    const category = await Category.find(parseInt(req.params.id))
    if (!category) {
      return res.json({ error: 'Category not found' }, 404)
    }

    await Category.delete(parseInt(req.params.id))
    res.json({ message: 'Category deleted' })
  }
}
