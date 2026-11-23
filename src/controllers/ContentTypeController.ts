import { ContentType, validateContentType, type ContentTypeRecord } from '../models/ContentType'
import type { Request, Response } from '../types'

/**
 * Content types: the admin's CRUD, and the public list at `/api/v1/types`.
 *
 * Writing a type needs `settings.manage`. A type decides URLs across the whole
 * site and what every editor sees, which is the weight of a site setting, not
 * of an editorial choice. Reading needs only a session or a content token —
 * the editor has to know a type's fields to show them.
 */
export const ContentTypeController = {
  async index(_req: Request, res: Response) {
    res.json({ content_types: await ContentType.all() })
  },

  async show(req: Request, res: Response) {
    const type = await findParam(req)
    if (!type) return res.json({ error: 'Content type not found' }, 404)
    res.json({ content_type: { ...type, post_count: await ContentType.postCount(type.key) } })
  },

  async store(req: Request, res: Response) {
    const checked = validateContentType(req.body, null)
    if ('errors' in checked) return res.json({ errors: checked.errors }, 422)

    const clash = await ContentType.clashes(checked.values)
    if (Object.keys(clash).length) return res.json({ errors: clash }, 422)

    const type = await ContentType.create(checked.values)
    res.json({ content_type: type }, 201)
  },

  async update(req: Request, res: Response) {
    const existing = await findParam(req)
    if (!existing) return res.json({ error: 'Content type not found' }, 404)

    const checked = validateContentType(req.body, existing)
    if ('errors' in checked) return res.json({ errors: checked.errors }, 422)

    const clash = await ContentType.clashes(checked.values, existing.id)
    if (Object.keys(clash).length) return res.json({ errors: clash }, 422)

    // A route base change moves every entry of the type. Redirects for that
    // are not written automatically (it could be thousands of rows); the
    // response says so, and the admin screen warns before saving.
    const moved = existing.route_base !== checked.values.route_base

    const type = await ContentType.update(existing.id, checked.values)
    res.json({ content_type: type, ...(moved ? { notice: `Entries now live under ${type.route_base}. Add a redirect from ${existing.route_base}/* if links to the old address exist.` } : {}) })
  },

  async destroy(req: Request, res: Response) {
    const existing = await findParam(req)
    if (!existing) return res.json({ error: 'Content type not found' }, 404)

    if (existing.builtin) {
      return res.json({ error: 'The built-in post type cannot be deleted.' }, 422)
    }

    // Deleting a type with entries would leave posts nothing can render or
    // edit as what they are. Moving or deleting them first is a decision the
    // admin should make knowingly, one post at a time if need be.
    const count = await ContentType.postCount(existing.key)
    if (count > 0) {
      return res.json({ error: `${count} ${count === 1 ? 'entry uses' : 'entries use'} this type. Move or delete them first.` }, 409)
    }

    await ContentType.delete(existing.id)
    res.json({ message: 'Content type deleted' })
  },

  /**
   * `GET /api/v1/types` — every public content type, with its field schema.
   *
   * What a front end needs to route and render custom types: where each lives
   * (`route_base`), what to call it, and which custom fields to expect in a
   * post's `fields`. Private types are left out with their entries.
   */
  async publicIndex(_req: Request, res: Response) {
    const types = await ContentType.all({ publicOnly: true })
    res.json({ data: types.map(presentType) })
  }
}

function presentType(type: ContentTypeRecord) {
  return {
    key: type.key,
    singular_label: type.singular_label,
    plural_label: type.plural_label,
    description: type.description,
    route_base: type.route_base,
    hierarchical: type.hierarchical,
    supports: type.supports,
    fields: type.supports.custom_fields ? type.fields : []
  }
}

async function findParam(req: Request): Promise<ContentTypeRecord | undefined> {
  const id = Number(req.params.id)
  return Number.isInteger(id) ? ContentType.find(id) : ContentType.findByKey(String(req.params.id))
}
