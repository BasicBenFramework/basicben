import { getDb, query } from '@basicbenframework/core/db'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { renderContent, slugify } from '@basicbenframework/core/content'
import type { Page as PageType } from '../types'

interface CreatePageData {
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

interface UpdatePageData {
  title?: string
  slug?: string
  content?: string
  template?: string
  published?: boolean
  parent_id?: number
  menu_order?: number
  meta_title?: string
  meta_description?: string
}

export const Page = {
  /**
   * One page of pages, with the total so a caller can size the pager.
   *
   * Counted separately rather than with a window function: the drivers do not
   * agree on those, and this runs on all of them.
   */
  async paginate(
    { perPage, offset }: { perPage: number; offset: number }
  ): Promise<{ pages: PageType[]; total: number }> {
    const db = await getDb()

    // `id` breaks ties. `created_at` alone is not a total order — these rows
    // are written in the same second all the time — and an unspecified order
    // is merely untidy until you paginate it, at which point LIMIT/OFFSET can
    // return a row on two pages and never return another. SQLite happens to be
    // stable here; Postgres is under no obligation to be.
    const pages = await db.all(
      'SELECT * FROM pages ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
      [perPage, offset]
    )

    const counted = await db.get('SELECT COUNT(*) AS total FROM pages')

    // Postgres returns bigint counts as strings rather than lose precision.
    return { pages, total: Number(counted?.total) || 0 }
  },

  async all(): Promise<PageType[]> {
    const db = await getDb()
    return db.all('SELECT * FROM pages ORDER BY menu_order ASC, title ASC')
  },

  async find(id: number): Promise<PageType | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM pages WHERE id = ?', [id])
  },

  async findBySlug(slug: string): Promise<PageType | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM pages WHERE slug = ?', [slug])
  },

  async findPublished(): Promise<PageType[]> {
    const db = await getDb()
    return db.all(`
      SELECT * FROM pages
      WHERE published = 1
      ORDER BY menu_order ASC, title ASC
    `)
  },

  async findPublishedBySlug(slug: string): Promise<PageType | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM pages WHERE slug = ? AND published = 1', [slug])
  },

  async tree(): Promise<PageType[]> {
    const pages = await this.all()
    return buildTree(pages)
  },

  async create(data: CreatePageData): Promise<PageType> {
    const db = await getDb()
    const slug = data.slug || slugify(data.title)
    const now = new Date().toISOString()

    // Markdown stays canonical; the HTML beside it is a cache built on write.
    const contentHtml = await renderContent(data.content || '', {
      context: { table: 'pages', slug }
    })

    // The last point a listener can alter what is stored. Its return value has
    // to be what gets written, or the filter is decoration.
    const contentSaved = await hooks.filter(HOOKS.CONTENT_SAVE, contentHtml, { type: 'page', data })

    // Through the query builder, which appends RETURNING id on Postgres. A raw
    // INSERT there reports lastInsertRowid as null, so the row is written and
    // the caller is handed an object with no id.
    const result = await (await query('pages')).insert({
      title: data.title,
      slug,
      content: data.content || null,
      content_html: contentSaved,
      template: data.template || 'default',
      published: data.published ? 1 : 0,
      parent_id: data.parent_id || null,
      menu_order: data.menu_order || 0,
      meta_title: data.meta_title || null,
      meta_description: data.meta_description || null,
      created_at: now,
      updated_at: now
    })

    return {
      id: result.lastInsertRowid as number,
      title: data.title,
      slug,
      content: data.content,
      content_html: contentSaved,
      template: data.template || 'default',
      published: data.published || false,
      parent_id: data.parent_id,
      menu_order: data.menu_order || 0,
      meta_title: data.meta_title,
      meta_description: data.meta_description,
      created_at: now,
      updated_at: now
    }
  },

  async update(id: number, data: UpdatePageData): Promise<PageType> {
    const db = await getDb()

    if (data.title && !data.slug) {
      data.slug = slugify(data.title)
    }

    const updateData: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() }

    if ('published' in data) {
      updateData.published = data.published ? 1 : 0
    }

    // Re-render whenever the source changes, so the two can never disagree.
    if ('content' in data) {
      updateData.content_html = await renderContent(data.content || '', {
        context: { table: 'pages', id }
      })
    }

    const fields = Object.keys(updateData).map(k => `${k} = ?`).join(', ')
    await db.run(
      `UPDATE pages SET ${fields} WHERE id = ?`,
      [...Object.values(updateData), id]
    )

    return this.find(id) as Promise<PageType>
  },

  async delete(id: number): Promise<void> {
    const db = await getDb()
    // Update children to remove parent
    await db.run('UPDATE pages SET parent_id = NULL WHERE parent_id = ?', [id])
    // Delete page
    await db.run('DELETE FROM pages WHERE id = ?', [id])
  },

  async slugExists(slug: string, excludeId?: number): Promise<boolean> {
    const db = await getDb()
    const query = excludeId
      ? 'SELECT id FROM pages WHERE slug = ? AND id != ?'
      : 'SELECT id FROM pages WHERE slug = ?'
    const params = excludeId ? [slug, excludeId] : [slug]
    const result = await db.get(query, params)
    return !!result
  },

  async reorder(pages: { id: number; menu_order: number }[]): Promise<void> {
    const db = await getDb()
    for (const { id, menu_order } of pages) {
      await db.run('UPDATE pages SET menu_order = ? WHERE id = ?', [menu_order, id])
    }
  }
}

function buildTree(pages: PageType[], parentId: number | null = null): PageType[] {
  return pages
    .filter(page => page.parent_id === parentId)
    .map(page => ({
      ...page,
      children: buildTree(pages, page.id)
    }))
}
