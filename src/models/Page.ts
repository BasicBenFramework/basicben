import { getDb, query } from '@basicbenframework/core/db'
import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { renderContent } from '@basicbenframework/core/content'
import { getStorage } from '@basicbenframework/core/storage'
import { uniqueSlug } from './derive'
import type { Page as PageType } from '../types'

interface CreatePageData {
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

interface UpdatePageData {
  title?: string
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

/**
 * Columns `update()` will write.
 *
 * The clause used to be built from whatever keys arrived, so a key that was not
 * a column — or was a column nobody meant to expose — went into the SQL.
 */
const UPDATABLE = [
  'title', 'slug', 'content', 'content_html', 'featured_image', 'template',
  'published', 'parent_id', 'menu_order', 'meta_title', 'meta_description',
  'updated_at'
]

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
      `${SELECT_PAGE} ORDER BY pages.created_at DESC, pages.id DESC LIMIT ? OFFSET ?`,
      [perPage, offset]
    )

    const counted = await db.get('SELECT COUNT(*) AS total FROM pages')

    // Postgres returns bigint counts as strings rather than lose precision.
    return { pages: await withFeaturedImages(pages), total: Number(counted?.total) || 0 }
  },

  async all(): Promise<PageType[]> {
    const db = await getDb()
    return withFeaturedImages(
      await db.all(`${SELECT_PAGE} ORDER BY pages.menu_order ASC, pages.title ASC`)
    )
  },

  async find(id: number): Promise<PageType | undefined> {
    const db = await getDb()
    return first(await db.get(`${SELECT_PAGE} WHERE pages.id = ?`, [id]))
  },

  async findBySlug(slug: string): Promise<PageType | undefined> {
    const db = await getDb()
    return first(await db.get(`${SELECT_PAGE} WHERE pages.slug = ?`, [slug]))
  },

  async findPublished(): Promise<PageType[]> {
    const db = await getDb()
    return withFeaturedImages(
      await db.all(`
        ${SELECT_PAGE}
        WHERE pages.published = 1
        ORDER BY pages.menu_order ASC, pages.title ASC
      `)
    )
  },

  async findPublishedBySlug(slug: string): Promise<PageType | undefined> {
    const db = await getDb()
    return first(
      await db.get(`${SELECT_PAGE} WHERE pages.slug = ? AND pages.published = 1`, [slug])
    )
  },

  async tree(): Promise<PageType[]> {
    const pages = await this.all()
    return buildTree(pages)
  },

  async create(data: CreatePageData): Promise<PageType> {
    const db = await getDb()

    // Derived from the title when the author left it blank, and made unique
    // either way: `pages.slug` is uniquely indexed, so a second "About" used to
    // fail the save rather than become `about-2`.
    const slug = await uniqueSlug('pages', data.slug || data.title, { fallback: 'page' })
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
      featured_image: data.featured_image ?? null,
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
      featured_image: data.featured_image ?? null,
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

    // A page keeps the slug it was published with. This used to re-derive it
    // from the title on every save, so correcting a typo in a heading silently
    // moved the page's URL and 404'd every link to it. Clearing the field is
    // still a request for a new one, derived from the title.
    // `undefined` means the caller said nothing about the slug — the controller
    // destructures a fixed field list, so the key is always present. An empty
    // string is a caller asking for a fresh one.
    const wantsSlug = data.slug !== undefined
    const slug = wantsSlug
      ? await uniqueSlug('pages', (data.slug || '').trim() || data.title || '', {
          excludeId: id,
          fallback: 'page'
        })
      : undefined

    const updateData: Record<string, unknown> = {
      ...data,
      ...(wantsSlug ? { slug } : {}),
      updated_at: new Date().toISOString()
    }

    // Only when the caller said something about it. The controller always
    // passes the key, so `'published' in data` was true even for a request that
    // never mentioned it — and a client sending just a title silently
    // unpublished the page.
    if (data.published !== undefined) {
      updateData.published = data.published ? 1 : 0
    }

    // Re-render whenever the source changes, so the two can never disagree.
    if ('content' in data) {
      updateData.content_html = await renderContent(data.content || '', {
        context: { table: 'pages', id }
      })
    }

    // `undefined` means the caller said nothing about that column — the
    // controller destructures a fixed list, so a client that sends only a title
    // would otherwise blank the template, the parent and the menu order.
    const writable = Object.entries(updateData).filter(
      ([key, value]) => UPDATABLE.includes(key) && value !== undefined
    )

    if (writable.length === 0) return this.find(id) as Promise<PageType>

    const fields = writable.map(([key]) => `${key} = ?`).join(', ')
    await db.run(
      `UPDATE pages SET ${fields} WHERE id = ?`,
      [...writable.map(([, value]) => value), id]
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

/**
 * Every page read joins its featured image.
 *
 * Written once so the eight read paths cannot disagree about whether a page has
 * one — which is how `posts` ended up rendering `/uploads/3` for a while: the
 * column holds a media id and the front end wants a URL.
 */
const SELECT_PAGE = `
  SELECT pages.*, media.path AS featured_image_path
  FROM pages
  LEFT JOIN media ON media.id = pages.featured_image
`

/** A page row as the join returns it: the page, plus the media key beside it. */
type PageRow = PageType & { featured_image_path?: string | null }

/** Resolve each featured image to a URL, in one adapter lookup for the batch. */
async function withFeaturedImages(rows: PageRow[]): Promise<PageType[]> {
  if (!rows.some((row) => row.featured_image_path)) return rows

  const storage = await getStorage()

  return rows.map((row) => ({
    ...row,
    featured_image_url: row.featured_image_path
      ? storage.publicUrl(row.featured_image_path)
      : null
  }))
}

/** The same resolution for a single row, which is what `find` deals in. */
async function first(row: PageRow | undefined): Promise<PageType | undefined> {
  return row ? (await withFeaturedImages([row]))[0] : undefined
}

function buildTree(pages: PageType[], parentId: number | null = null): PageType[] {
  return pages
    .filter(page => page.parent_id === parentId)
    .map(page => ({
      ...page,
      children: buildTree(pages, page.id)
    }))
}
