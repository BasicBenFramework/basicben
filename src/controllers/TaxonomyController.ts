import { Taxonomy, validateTaxonomy, validateTerm, type TaxonomyRecord } from '../models/Taxonomy'
import type { Request, Response } from '../types'

/**
 * Custom taxonomies and their terms: admin CRUD and the public reads.
 *
 * Defining a taxonomy is `settings.manage`, like a content type — it changes
 * the shape of the editor for everyone. Managing its terms is
 * `category.manage`, the same capability that manages categories, because a
 * cuisine is to a recipe what a category is to a post.
 */
export const TaxonomyController = {
  async index(req: Request, res: Response) {
    const type = typeof req.query.type === 'string' ? req.query.type : undefined
    res.json({ taxonomies: await Taxonomy.all({ contentType: type }) })
  },

  async store(req: Request, res: Response) {
    const checked = validateTaxonomy(req.body, null)
    if ('errors' in checked) return res.json({ errors: checked.errors }, 422)

    if (await Taxonomy.keyTaken(checked.values.key)) {
      return res.json({ errors: { key: ['A taxonomy with this key already exists'] } }, 422)
    }

    const unknown = await Taxonomy.unknownContentTypes(checked.values.content_types)
    if (unknown.length) return res.json({ errors: { content_types: [`Unknown content type: ${unknown.join(', ')}`] } }, 422)

    res.json({ taxonomy: await Taxonomy.create(checked.values) }, 201)
  },

  async update(req: Request, res: Response) {
    const existing = await findTaxonomy(req)
    if (!existing) return res.json({ error: 'Taxonomy not found' }, 404)

    const checked = validateTaxonomy(req.body, existing)
    if ('errors' in checked) return res.json({ errors: checked.errors }, 422)

    const unknown = await Taxonomy.unknownContentTypes(checked.values.content_types)
    if (unknown.length) return res.json({ errors: { content_types: [`Unknown content type: ${unknown.join(', ')}`] } }, 422)

    res.json({ taxonomy: await Taxonomy.update(existing.id, checked.values) })
  },

  /** Deletes the taxonomy, its terms, and every post's link to them. */
  async destroy(req: Request, res: Response) {
    const existing = await findTaxonomy(req)
    if (!existing) return res.json({ error: 'Taxonomy not found' }, 404)

    await Taxonomy.delete(existing.id)
    res.json({ message: 'Taxonomy deleted' })
  },

  async terms(req: Request, res: Response) {
    const taxonomy = await findTaxonomy(req)
    if (!taxonomy) return res.json({ error: 'Taxonomy not found' }, 404)

    res.json({ taxonomy, terms: await Taxonomy.terms(taxonomy.id) })
  },

  async storeTerm(req: Request, res: Response) {
    const taxonomy = await findTaxonomy(req)
    if (!taxonomy) return res.json({ error: 'Taxonomy not found' }, 404)

    const checked = validateTerm(req.body, null)
    if ('errors' in checked) return res.json({ errors: checked.errors }, 422)

    const parentError = await checkParent(taxonomy, checked.values.parent_id)
    if (parentError) return res.json({ errors: { parent_id: [parentError] } }, 422)

    if (await Taxonomy.termSlugTaken(taxonomy.id, checked.values.slug)) {
      return res.json({ errors: { slug: [`"${checked.values.slug}" is already a ${taxonomy.singular_label.toLowerCase()}`] } }, 422)
    }

    res.json({ term: await Taxonomy.createTerm(taxonomy.id, checked.values) }, 201)
  },

  async updateTerm(req: Request, res: Response) {
    const term = await Taxonomy.findTerm(Number(req.params.id))
    if (!term) return res.json({ error: 'Term not found' }, 404)
    const taxonomy = (await Taxonomy.find(term.taxonomy_id))!

    const checked = validateTerm(req.body, term)
    if ('errors' in checked) return res.json({ errors: checked.errors }, 422)

    const parentError = await checkParent(taxonomy, checked.values.parent_id, term.id)
    if (parentError) return res.json({ errors: { parent_id: [parentError] } }, 422)

    if (await Taxonomy.termSlugTaken(taxonomy.id, checked.values.slug, term.id)) {
      return res.json({ errors: { slug: [`"${checked.values.slug}" is already a ${taxonomy.singular_label.toLowerCase()}`] } }, 422)
    }

    res.json({ term: await Taxonomy.updateTerm(term.id, checked.values) })
  },

  async destroyTerm(req: Request, res: Response) {
    const term = await Taxonomy.findTerm(Number(req.params.id))
    if (!term) return res.json({ error: 'Term not found' }, 404)

    await Taxonomy.deleteTerm(term.id)
    res.json({ message: 'Term deleted' })
  },

  /** `GET /api/v1/taxonomies` — every public custom taxonomy. */
  async publicIndex(_req: Request, res: Response) {
    const taxonomies = await Taxonomy.all({ publicOnly: true })
    res.json({ data: taxonomies.map(presentTaxonomy) })
  },

  /** `GET /api/v1/taxonomies/:key/terms` — a public taxonomy's terms, with live-post counts. */
  async publicTerms(req: Request, res: Response) {
    const taxonomy = await Taxonomy.findByKey(String(req.params.key))
    if (!taxonomy || !taxonomy.public) return res.json({ error: 'Not found' }, 404)

    const terms = await Taxonomy.terms(taxonomy.id)
    res.json({
      data: terms.map((term) => ({
        id: term.id,
        name: term.name,
        slug: term.slug,
        description: term.description,
        parent_id: term.parent_id,
        post_count: term.post_count ?? 0
      })),
      meta: { taxonomy: presentTaxonomy(taxonomy) }
    })
  }
}

function presentTaxonomy(taxonomy: TaxonomyRecord) {
  return {
    key: taxonomy.key,
    singular_label: taxonomy.singular_label,
    plural_label: taxonomy.plural_label,
    description: taxonomy.description,
    hierarchical: taxonomy.hierarchical,
    content_types: taxonomy.content_types
  }
}

async function findTaxonomy(req: Request): Promise<TaxonomyRecord | undefined> {
  const id = Number(req.params.id)
  return Number.isInteger(id) ? Taxonomy.find(id) : Taxonomy.findByKey(String(req.params.id))
}

/**
 * A parent must be a term of the same taxonomy, the taxonomy must allow
 * nesting, and the parent must not sit below the term being moved — or the
 * tree would loop and every breadcrumb built from it would never finish.
 */
async function checkParent(taxonomy: TaxonomyRecord, parentId: number | null, termId?: number): Promise<string | null> {
  if (parentId === null) return null
  if (!taxonomy.hierarchical) return `${taxonomy.plural_label} do not nest`

  let cursor: number | null = parentId
  for (let hops = 0; cursor !== null && hops < 50; hops++) {
    if (cursor === termId) return 'A term cannot sit below itself'
    const parent = await Taxonomy.findTerm(cursor)
    if (!parent || parent.taxonomy_id !== taxonomy.id) return 'The parent must be a term of the same taxonomy'
    cursor = parent.parent_id
  }
  return null
}
