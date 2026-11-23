/**
 * Custom taxonomies and their terms.
 *
 * Categories and tags keep their own tables (see migration 040 for why); this
 * is everything beyond them — "cuisine", "diet", "season" — each attached to
 * the content types it applies to. A post's terms are only ever ones from a
 * taxonomy attached to its type: the sync below drops anything else rather
 * than filing a blog post under a recipe's cuisine.
 *
 * Validators are pure and exported for tests. Imports carry `.ts` extensions
 * so this loads under plain Node too.
 */

import { getDb, query } from '@basicbenframework/core/db'
import { slugify } from '@basicbenframework/core/content'
import { livePost } from './visibility.ts'

/** Keys the built-in taxonomies answer to, and words the API already uses. */
export const RESERVED_TAXONOMY_KEYS = ['category', 'categories', 'tag', 'tags', 'post_tag', 'type', 'author', 'any']

export interface TaxonomyRecord {
  id: number
  key: string
  singular_label: string
  plural_label: string
  description: string | null
  hierarchical: boolean
  public: boolean
  /** Keys of the content types this taxonomy applies to. */
  content_types: string[]
}

export interface TermRecord {
  id: number
  taxonomy_id: number
  name: string
  slug: string
  description: string | null
  parent_id: number | null
  sort_order: number
  /** Live posts carrying this term. Present on listings. */
  post_count?: number
}

type Errors = Record<string, string[]>

const truthy = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on'

function label(value: unknown, max = 100): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

/** A taxonomy definition. `existing` is null on create; the key is fixed after. */
export function validateTaxonomy(
  input: unknown,
  existing: TaxonomyRecord | null = null
): { values: Omit<TaxonomyRecord, 'id'> } | { errors: Errors } {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const errors: Errors = {}

  let key = existing?.key ?? ''
  if (!existing) {
    const raw = typeof body.key === 'string' ? body.key.trim().toLowerCase() : ''
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(raw)) {
      errors.key = ['Key must start with a letter and use lowercase letters, digits and underscores (32 at most)']
    } else if (RESERVED_TAXONOMY_KEYS.includes(raw)) {
      errors.key = [`"${raw}" is reserved — categories and tags are built in`]
    }
    key = raw
  } else if (body.key !== undefined && body.key !== existing.key) {
    errors.key = ['The key cannot be changed once a taxonomy exists']
  }

  const singular = 'singular_label' in body || !existing ? label(body.singular_label) : existing.singular_label
  const plural = 'plural_label' in body || !existing ? label(body.plural_label) : existing.plural_label
  if (!singular) errors.singular_label = ['Singular label is required (100 characters at most)']
  if (!plural) errors.plural_label = ['Plural label is required (100 characters at most)']

  const description = 'description' in body
    ? (typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 1000) : null)
    : existing?.description ?? null

  let contentTypes = existing?.content_types ?? ['post']
  if ('content_types' in body) {
    if (!Array.isArray(body.content_types) || body.content_types.some((item) => typeof item !== 'string')) {
      errors.content_types = ['Content types must be a list of type keys']
    } else {
      contentTypes = [...new Set(body.content_types as string[])]
    }
  }

  if (Object.keys(errors).length) return { errors }

  return {
    values: {
      key,
      singular_label: singular!,
      plural_label: plural!,
      description,
      hierarchical: 'hierarchical' in body ? truthy(body.hierarchical) : existing?.hierarchical ?? false,
      public: 'public' in body ? truthy(body.public) : existing?.public ?? true,
      content_types: contentTypes
    }
  }
}

/** A term's name, slug and parent. The slug is derived when left blank. */
export function validateTerm(
  input: unknown,
  existing: TermRecord | null = null
): { values: { name: string; slug: string; description: string | null; parent_id: number | null } } | { errors: Errors } {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const errors: Errors = {}

  const name = 'name' in body || !existing ? label(body.name, 200) : existing.name
  if (!name) errors.name = ['Name is required (200 characters at most)']

  const typedSlug = typeof body.slug === 'string' ? body.slug.trim() : ''
  const slug = typedSlug ? slugify(typedSlug) : 'slug' in body || !existing ? slugify(name || '') : existing.slug
  if (!slug) errors.slug = ['Could not make a slug from that — type one']

  const description = 'description' in body
    ? (typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 1000) : null)
    : existing?.description ?? null

  let parentId = existing?.parent_id ?? null
  if ('parent_id' in body) {
    const id = Number(body.parent_id)
    parentId = Number.isInteger(id) && id > 0 ? id : null
    if (existing && parentId === existing.id) errors.parent_id = ['A term cannot be its own parent']
  }

  if (Object.keys(errors).length) return { errors }
  return { values: { name: name!, slug, description, parent_id: parentId } }
}

/**
 * `?taxonomy[cuisine]=italian` and `?tax=cuisine:italian,diet:vegan` as one map.
 *
 * Both spellings because the first is what a form or a PHP-minded consumer
 * builds and the second fits in a URL someone types. The framework parses the
 * query string flat, so the bracketed form arrives as a key named
 * `taxonomy[cuisine]`. Several filters combine with AND, like `?category=`
 * and `?tag=` do.
 */
export function taxonomyFilters(query: Record<string, unknown>, tax: unknown = query?.tax): Record<string, string> {
  const filters: Record<string, string> = {}

  for (const [name, value] of Object.entries(query ?? {})) {
    const match = name.match(/^taxonomy\[([a-z][a-z0-9_]{0,31})\]$/)
    if (match && typeof value === 'string' && value) filters[match[1]] = value.slice(0, 200)
  }

  if (typeof tax === 'string') {
    for (const pair of tax.split(',').slice(0, 10)) {
      const [key, slug] = pair.split(':').map((part) => part.trim())
      if (key && slug && /^[a-z][a-z0-9_]{0,31}$/.test(key)) filters[key] = slug.slice(0, 200)
    }
  }

  return filters
}

/**
 * SQL that narrows `posts` to entries carrying every given term.
 *
 * One `IN (subquery)` per taxonomy, all bound — keys and slugs are input. A
 * taxonomy that does not exist, or is not public, matches nothing, so an
 * archive for it is empty rather than unfiltered.
 */
export function taxonomyWhere(alias: string, filters: Record<string, string>): { where: string[]; params: unknown[] } {
  const where: string[] = []
  const params: unknown[] = []

  for (const [key, slug] of Object.entries(filters)) {
    where.push(`${alias}.id IN (
      SELECT tr.post_id FROM term_relationships tr
      JOIN terms ON terms.id = tr.term_id
      JOIN taxonomies ON taxonomies.id = terms.taxonomy_id
      WHERE taxonomies.key = ? AND taxonomies.is_public = 1 AND (terms.slug = ? OR terms.id = ?)
    )`)
    params.push(key, slug, Number(slug) || -1)
  }

  return { where, params }
}

// --- Database ----------------------------------------------------------------

interface TaxonomyRow {
  id: number
  key: string
  singular_label: string
  plural_label: string
  description: string | null
  hierarchical: number
  is_public: number
}

async function loadAll(): Promise<TaxonomyRecord[]> {
  const db = await getDb()
  const rows = (await db.all('SELECT * FROM taxonomies ORDER BY plural_label ASC, id ASC')) as TaxonomyRow[]
  const links = (await db.all(
    `SELECT tct.taxonomy_id, ct.key FROM taxonomy_content_types tct
     JOIN content_types ct ON ct.id = tct.content_type_id`
  )) as Array<{ taxonomy_id: number; key: string }>

  return rows.map((row) => ({
    id: Number(row.id),
    key: row.key,
    singular_label: row.singular_label,
    plural_label: row.plural_label,
    description: row.description,
    hierarchical: Boolean(Number(row.hierarchical)),
    public: Boolean(Number(row.is_public)),
    content_types: links.filter((link) => Number(link.taxonomy_id) === Number(row.id)).map((link) => link.key)
  }))
}

function shapeTerm(row: Record<string, unknown>): TermRecord {
  return {
    id: Number(row.id),
    taxonomy_id: Number(row.taxonomy_id),
    name: String(row.name),
    slug: String(row.slug),
    description: (row.description as string | null) ?? null,
    parent_id: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
    sort_order: Number(row.sort_order) || 0,
    ...(row.post_count !== undefined ? { post_count: Number(row.post_count) || 0 } : {})
  }
}

export const Taxonomy = {
  async all(options: { publicOnly?: boolean; contentType?: string } = {}): Promise<TaxonomyRecord[]> {
    let list = await loadAll()
    if (options.publicOnly) list = list.filter((taxonomy) => taxonomy.public)
    if (options.contentType) list = list.filter((taxonomy) => taxonomy.content_types.includes(options.contentType!))
    return list
  },

  async find(id: number): Promise<TaxonomyRecord | undefined> {
    return (await loadAll()).find((taxonomy) => taxonomy.id === id)
  },

  async findByKey(key: string): Promise<TaxonomyRecord | undefined> {
    return (await loadAll()).find((taxonomy) => taxonomy.key === key)
  },

  async keyTaken(key: string, excludeId?: number): Promise<boolean> {
    return (await loadAll()).some((taxonomy) => taxonomy.key === key && taxonomy.id !== excludeId)
  },

  /** Content type keys that do not exist, so the controller can name them. */
  async unknownContentTypes(keys: string[]): Promise<string[]> {
    const db = await getDb()
    const rows = (await db.all('SELECT key FROM content_types')) as Array<{ key: string }>
    const known = new Set(rows.map((row) => row.key))
    return keys.filter((key) => !known.has(key))
  },

  async create(values: Omit<TaxonomyRecord, 'id'>): Promise<TaxonomyRecord> {
    const result = await (await query('taxonomies')).insert({
      key: values.key,
      singular_label: values.singular_label,
      plural_label: values.plural_label,
      description: values.description,
      hierarchical: values.hierarchical ? 1 : 0,
      is_public: values.public ? 1 : 0
    })
    const id = Number(result.lastInsertRowid)
    await this.attach(id, values.content_types)
    return (await this.find(id))!
  },

  async update(id: number, values: Omit<TaxonomyRecord, 'id'>): Promise<TaxonomyRecord> {
    const db = await getDb()
    await db.run(
      `UPDATE taxonomies SET singular_label = ?, plural_label = ?, description = ?, hierarchical = ?, is_public = ?, updated_at = ?
       WHERE id = ?`,
      [values.singular_label, values.plural_label, values.description, values.hierarchical ? 1 : 0,
        values.public ? 1 : 0, new Date().toISOString(), id]
    )
    await this.attach(id, values.content_types)
    return (await this.find(id))!
  },

  /** Replace which content types the taxonomy applies to. */
  async attach(id: number, contentTypes: string[]): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM taxonomy_content_types WHERE taxonomy_id = ?', [id])
    for (const key of contentTypes) {
      await db.run(
        `INSERT INTO taxonomy_content_types (taxonomy_id, content_type_id)
         SELECT ?, id FROM content_types WHERE key = ?`,
        [id, key]
      )
    }
  },

  /** Deletes its terms and every post's link to them, through the cascades. */
  async delete(id: number): Promise<void> {
    const db = await getDb()
    // Spelled out as well as cascaded: SQLite only honours ON DELETE when
    // foreign keys are switched on for the connection.
    await db.run('DELETE FROM term_relationships WHERE term_id IN (SELECT id FROM terms WHERE taxonomy_id = ?)', [id])
    await db.run('DELETE FROM terms WHERE taxonomy_id = ?', [id])
    await db.run('DELETE FROM taxonomy_content_types WHERE taxonomy_id = ?', [id])
    await db.run('DELETE FROM taxonomies WHERE id = ?', [id])
  },

  /**
   * A taxonomy's terms, with live-post counts.
   *
   * Counted the way categories are: every live post carrying the term, through
   * the shared visibility predicate, so a scheduled post is not counted early.
   */
  async terms(taxonomyId: number): Promise<TermRecord[]> {
    const db = await getDb()
    const rows = (await db.all(
      `SELECT t.id, t.taxonomy_id, t.name, t.slug, t.description, t.parent_id, t.sort_order,
              COUNT(p.id) AS post_count
       FROM terms t
       LEFT JOIN term_relationships tr ON tr.term_id = t.id
       LEFT JOIN posts p ON p.id = tr.post_id AND ${livePost('p')}
       WHERE t.taxonomy_id = ?
       GROUP BY t.id, t.taxonomy_id, t.name, t.slug, t.description, t.parent_id, t.sort_order
       ORDER BY t.sort_order ASC, t.name ASC`,
      [taxonomyId]
    )) as Array<Record<string, unknown>>
    return rows.map(shapeTerm)
  },

  async findTerm(id: number): Promise<TermRecord | undefined> {
    const db = await getDb()
    const row = await db.get('SELECT * FROM terms WHERE id = ?', [id])
    return row ? shapeTerm(row) : undefined
  },

  async findTermBySlug(taxonomyId: number, slug: string): Promise<TermRecord | undefined> {
    const db = await getDb()
    const row = await db.get('SELECT * FROM terms WHERE taxonomy_id = ? AND slug = ?', [taxonomyId, slug])
    return row ? shapeTerm(row) : undefined
  },

  async termSlugTaken(taxonomyId: number, slug: string, excludeId?: number): Promise<boolean> {
    const db = await getDb()
    const row = await db.get(
      'SELECT id FROM terms WHERE taxonomy_id = ? AND slug = ? AND id != ?',
      [taxonomyId, slug, excludeId ?? -1]
    )
    return Boolean(row)
  },

  async createTerm(taxonomyId: number, values: { name: string; slug: string; description: string | null; parent_id: number | null }): Promise<TermRecord> {
    const result = await (await query('terms')).insert({ taxonomy_id: taxonomyId, ...values })
    return (await this.findTerm(Number(result.lastInsertRowid)))!
  },

  async updateTerm(id: number, values: { name: string; slug: string; description: string | null; parent_id: number | null }): Promise<TermRecord> {
    const db = await getDb()
    await db.run(
      'UPDATE terms SET name = ?, slug = ?, description = ?, parent_id = ? WHERE id = ?',
      [values.name, values.slug, values.description, values.parent_id, id]
    )
    return (await this.findTerm(id))!
  },

  async deleteTerm(id: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM term_relationships WHERE term_id = ?', [id])
    await db.run('UPDATE terms SET parent_id = NULL WHERE parent_id = ?', [id])
    await db.run('DELETE FROM terms WHERE id = ?', [id])
  },

  /** The ids of a post's custom terms, for the editor to preselect. */
  async termIdsFor(postId: number): Promise<number[]> {
    const db = await getDb()
    const rows = (await db.all('SELECT term_id FROM term_relationships WHERE post_id = ?', [postId])) as Array<{ term_id: number }>
    return rows.map((row) => Number(row.term_id))
  },

  /**
   * Replace a post's custom terms.
   *
   * Rebuilt, like categories and tags, because the editor sends the whole set.
   * Only terms of taxonomies attached to the post's type survive: the editor
   * never offers others, and an API caller sending one is filing the post
   * somewhere its type has no place for.
   */
  async syncPostTerms(postId: number, termIds: unknown[]): Promise<void> {
    const db = await getDb()
    const ids = [...new Set(termIds.map(Number).filter(Number.isInteger))]

    const post = await db.get('SELECT post_type FROM posts WHERE id = ?', [postId])
    if (!post) return

    let allowed: number[] = []
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(', ')
      const rows = (await db.all(
        `SELECT terms.id FROM terms
         JOIN taxonomy_content_types tct ON tct.taxonomy_id = terms.taxonomy_id
         JOIN content_types ct ON ct.id = tct.content_type_id
         WHERE ct.key = ? AND terms.id IN (${placeholders})`,
        [post.post_type || 'post', ...ids]
      )) as Array<{ id: number }>
      allowed = rows.map((row) => Number(row.id))
    }

    await db.run('DELETE FROM term_relationships WHERE post_id = ?', [postId])
    for (const id of allowed) {
      await db.run('INSERT INTO term_relationships (post_id, term_id) VALUES (?, ?)', [postId, id])
    }
  }
}
