/**
 * Navigation menus and their items.
 *
 * The admin side reads and writes raw rows. The public side goes through
 * `publicNavigation()`, which resolves linked content to its current path and
 * leaves out anything a visitor could not open — so a menu never links to a
 * draft, a trashed post, or a page that was deleted out from under it.
 */

import { getDb, query } from '@basicbenframework/core/db'
import { livePost, livePage } from './visibility.ts'
import { postPath, pagePath, categoryPath, isSafeLinkUrl } from '../helpers/content-paths.ts'

export const TARGET_TYPES = ['post', 'page', 'category'] as const
export type TargetType = (typeof TARGET_TYPES)[number]

export interface MenuRow {
  id: number
  location: string
  name: string
  created_at: string
  updated_at: string
}

export interface MenuItemRow {
  id: number
  menu_id: number
  parent_id: number | null
  label: string
  url: string | null
  target_type: TargetType | null
  target_id: number | null
  open_in_new_tab: number | boolean
  sort_order: number
  created_at?: string
  updated_at?: string
}

/** A menu item as `/api/v1/navigation` returns it. */
export interface PublicMenuItem {
  id: number
  label: string
  /** Where the link goes: a site-relative path for linked content, or the URL as entered. */
  url: string
  /** `url` for a typed link, otherwise the kind of content linked. */
  type: 'url' | TargetType
  /** The linked content, so a front end with its own URL scheme can build its own link. Null for typed links. */
  target: { id: number; slug: string } | null
  /** Open in a new tab/window. */
  new_tab: boolean
  children: PublicMenuItem[]
}

/** Slugs of the linked content a visitor may see, by type and id. */
export type ResolvedTargets = Record<TargetType, Map<number, string>>

/**
 * Turn item rows into the public tree.
 *
 * An item linking to content that is not in `targets` — unpublished, trashed,
 * scheduled, deleted — is dropped, and so are its children: a dropdown whose
 * heading has gone would otherwise appear as orphaned links with no parent to
 * hang from, and promoting them to the top level silently restructures the
 * menu the admin built. Pure, so it is tested without a database.
 */
export function buildPublicTree(items: MenuItemRow[], targets: ResolvedTargets): PublicMenuItem[] {
  const present = (item: MenuItemRow): PublicMenuItem | null => {
    let url: string
    let target: PublicMenuItem['target'] = null

    if (item.target_type && item.target_id) {
      const slug = targets[item.target_type]?.get(Number(item.target_id))
      if (slug === undefined) return null

      url = item.target_type === 'post' ? postPath(slug, item.target_id)
        : item.target_type === 'page' ? pagePath(slug)
          : categoryPath(slug)
      target = { id: Number(item.target_id), slug }
    } else if (item.url) {
      url = item.url
    } else {
      return null
    }

    return {
      id: item.id,
      label: item.label,
      url,
      type: item.target_type ?? 'url',
      target,
      new_tab: Boolean(Number(item.open_in_new_tab)),
      children: []
    }
  }

  const ordered = [...items].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  const top = new Map<number, PublicMenuItem>()
  const tree: PublicMenuItem[] = []

  for (const item of ordered.filter(row => !row.parent_id)) {
    const node = present(item)
    if (!node) continue
    top.set(item.id, node)
    tree.push(node)
  }

  for (const item of ordered.filter(row => row.parent_id)) {
    const parent = top.get(Number(item.parent_id))
    const node = parent ? present(item) : null
    if (parent && node) parent.children.push(node)
  }

  return tree
}

/** What a menu's `location` may be: a short identifier a front end can hard-code. */
export const LOCATION_PATTERN = /^[a-z][a-z0-9_-]{0,49}$/

/** Locations every install has. They can be emptied but not deleted. */
export const BUILT_IN_LOCATIONS = ['primary', 'secondary', 'footer']

export type MenuItemValues = Omit<MenuItemRow, 'id' | 'menu_id' | 'created_at' | 'updated_at'>

/**
 * Validate a menu item's fields (not its relationships — whether the parent
 * and target exist needs the database, and the controller checks those).
 *
 * An item is a typed link *or* a link to content, never both: given a target,
 * any URL is discarded, so there is one answer to "where does this go".
 */
export function validateMenuItem(input: Record<string, unknown>):
  | { values: Omit<MenuItemValues, 'sort_order'> & { sort_order: number | null } }
  | { errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {}

  const label = typeof input.label === 'string' ? input.label.trim() : ''
  if (label === '') errors.label = ['Label is required']
  else if (label.length > 120) errors.label = ['Label must be at most 120 characters']

  let url: string | null = null
  let targetType: TargetType | null = null
  let targetId: number | null = null

  const hasTarget = input.target_type !== undefined && input.target_type !== null && input.target_type !== ''

  if (hasTarget) {
    if (!(TARGET_TYPES as readonly unknown[]).includes(input.target_type)) {
      errors.target_type = ['Must be post, page or category']
    } else {
      targetType = input.target_type as TargetType
    }

    const id = Number(input.target_id)
    if (!Number.isInteger(id) || id <= 0) errors.target_id = ['Choose what to link to']
    else targetId = id
  } else if (isSafeLinkUrl(input.url)) {
    url = (input.url as string).trim()
  } else {
    errors.url = ['Must be an http(s) URL, a path starting with /, or a mailto: link']
  }

  let parentId: number | null = null
  if (input.parent_id !== undefined && input.parent_id !== null && input.parent_id !== '') {
    const id = Number(input.parent_id)
    if (!Number.isInteger(id) || id <= 0) errors.parent_id = ['Invalid parent']
    else parentId = id
  }

  let sortOrder: number | null = null
  if (input.sort_order !== undefined && input.sort_order !== null && input.sort_order !== '') {
    const n = Number(input.sort_order)
    if (!Number.isInteger(n) || n < 0) errors.sort_order = ['Must be a whole number']
    else sortOrder = n
  }

  if (Object.keys(errors).length) return { errors }

  return {
    values: {
      label,
      url,
      target_type: targetType,
      target_id: targetId,
      parent_id: parentId,
      open_in_new_tab: input.open_in_new_tab === true || input.open_in_new_tab === 'true' || input.open_in_new_tab === 1,
      sort_order: sortOrder
    }
  }
}

/**
 * Validate a reorder of one menu: the complete list of its items with each
 * one's parent, in display order.
 *
 * Complete, not partial — a partial list could move a parent under another
 * item while leaving its children where they were, producing the second
 * level of nesting the menu does not support. Pure, for tests.
 */
export function validateReorder(
  input: unknown,
  existingIds: number[]
): { order: Array<{ id: number; parent_id: number | null; sort_order: number }> } | { error: string } {
  if (!Array.isArray(input)) return { error: 'Items array is required' }

  const order = input.map((entry, index) => ({
    id: Number(entry?.id),
    parent_id: entry?.parent_id === null || entry?.parent_id === undefined || entry?.parent_id === '' ? null : Number(entry.parent_id),
    sort_order: index
  }))

  const ids = new Set(order.map(item => item.id))
  const known = new Set(existingIds)

  if (ids.size !== order.length) return { error: 'Each item may appear only once' }
  if (ids.size !== known.size || [...ids].some(id => !known.has(id))) {
    return { error: 'The list must contain every item in this menu, and only those' }
  }

  const topLevel = new Set(order.filter(item => item.parent_id === null).map(item => item.id))

  for (const item of order) {
    if (item.parent_id === null) continue
    if (item.parent_id === item.id) return { error: 'An item cannot be its own parent' }
    if (!topLevel.has(item.parent_id)) return { error: 'Items can be nested one level deep, under a top-level item' }
  }

  return { order }
}

const placeholders = (n: number) => Array(n).fill('?').join(', ')

export const Menu = {
  async all(): Promise<MenuRow[]> {
    const db = await getDb()
    return db.all('SELECT * FROM menus ORDER BY id')
  },

  async find(id: number): Promise<MenuRow | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM menus WHERE id = ?', [id])
  },

  async findByLocation(location: string): Promise<MenuRow | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM menus WHERE location = ?', [location])
  },

  async create(data: { location: string; name: string }): Promise<MenuRow | undefined> {
    const db = await getDb()
    const now = new Date().toISOString()

    // Raw INSERT then a read by the unique location, which behaves the same on
    // every adapter without relying on RETURNING.
    await db.run(
      'INSERT INTO menus (location, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [data.location, data.name, now, now]
    )

    return this.findByLocation(data.location)
  },

  async update(id: number, data: { location: string; name: string }): Promise<MenuRow | undefined> {
    const db = await getDb()
    await db.run(
      'UPDATE menus SET location = ?, name = ?, updated_at = ? WHERE id = ?',
      [data.location, data.name, new Date().toISOString(), id]
    )
    return this.find(id)
  },

  async delete(id: number): Promise<void> {
    const db = await getDb()
    // Explicitly rather than by ON DELETE CASCADE, which SQLite only honours
    // with foreign_keys switched on for the connection.
    await db.run('DELETE FROM menu_items WHERE menu_id = ?', [id])
    await db.run('DELETE FROM menus WHERE id = ?', [id])
  },

  async items(menuId: number): Promise<MenuItemRow[]> {
    const db = await getDb()
    return db.all('SELECT * FROM menu_items WHERE menu_id = ? ORDER BY sort_order, id', [menuId])
  },

  async findItem(id: number): Promise<MenuItemRow | undefined> {
    const db = await getDb()
    return db.get('SELECT * FROM menu_items WHERE id = ?', [id])
  },

  async createItem(menuId: number, data: MenuItemValues): Promise<MenuItemRow | undefined> {
    const db = await getDb()
    const now = new Date().toISOString()

    // There is no natural unique key to read an item back by, so this one
    // goes through the query builder, which appends RETURNING id on Postgres.
    const result = await (await query('menu_items')).insert({
      menu_id: menuId,
      parent_id: data.parent_id,
      label: data.label,
      url: data.url,
      target_type: data.target_type,
      target_id: data.target_id,
      open_in_new_tab: data.open_in_new_tab ? 1 : 0,
      sort_order: data.sort_order,
      created_at: now,
      updated_at: now
    })

    return this.findItem(Number(result.lastInsertRowid))
  },

  async updateItem(id: number, data: MenuItemValues): Promise<MenuItemRow | undefined> {
    const db = await getDb()
    await db.run(
      `UPDATE menu_items
         SET parent_id = ?, label = ?, url = ?, target_type = ?, target_id = ?,
             open_in_new_tab = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
      [data.parent_id, data.label, data.url, data.target_type, data.target_id,
        data.open_in_new_tab ? 1 : 0, data.sort_order, new Date().toISOString(), id]
    )
    return this.findItem(id)
  },

  async deleteItem(id: number): Promise<void> {
    const db = await getDb()
    await db.run('DELETE FROM menu_items WHERE parent_id = ?', [id])
    await db.run('DELETE FROM menu_items WHERE id = ?', [id])
  },

  /** Apply a validated ordering: each item's parent and position. */
  async reorder(order: Array<{ id: number; parent_id: number | null; sort_order: number }>): Promise<void> {
    const db = await getDb()
    const now = new Date().toISOString()

    for (const item of order) {
      await db.run(
        'UPDATE menu_items SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?',
        [item.parent_id, item.sort_order, now, item.id]
      )
    }
  },

  /** The next sort position at the end of a menu (or of one parent's children). */
  async nextSortOrder(menuId: number, parentId: number | null): Promise<number> {
    const db = await getDb()
    const row = parentId
      ? await db.get('SELECT MAX(sort_order) AS max FROM menu_items WHERE menu_id = ? AND parent_id = ?', [menuId, parentId])
      : await db.get('SELECT MAX(sort_order) AS max FROM menu_items WHERE menu_id = ? AND parent_id IS NULL', [menuId])
    return row?.max === null || row?.max === undefined ? 0 : Number(row.max) + 1
  },

  /** Does the linked content exist at all? (Admins may link to a draft.) */
  async targetExists(type: TargetType, id: number): Promise<boolean> {
    const db = await getDb()
    const table = type === 'post' ? 'posts' : type === 'page' ? 'pages' : 'categories'
    return Boolean(await db.get(`SELECT id FROM ${table} WHERE id = ?`, [id]))
  },

  /**
   * Every menu, keyed by location, resolved for the public.
   *
   * Three queries for the linked content however many items there are — one
   * per type, by id — rather than a lookup per item.
   */
  async publicNavigation(location?: string): Promise<Record<string, PublicMenuItem[]>> {
    const db = await getDb()

    const menus: MenuRow[] = location
      ? await db.all('SELECT * FROM menus WHERE location = ?', [location])
      : await db.all('SELECT * FROM menus ORDER BY id')

    if (menus.length === 0) return {}

    const items: MenuItemRow[] = await db.all(
      `SELECT * FROM menu_items WHERE menu_id IN (${placeholders(menus.length)}) ORDER BY sort_order, id`,
      menus.map(menu => menu.id)
    )

    const ids = (type: TargetType) =>
      [...new Set(items.filter(item => item.target_type === type && item.target_id).map(item => Number(item.target_id)))]

    const lookup = async (type: TargetType, sql: (list: string) => string) => {
      const list = ids(type)
      const map = new Map<number, string>()
      if (list.length === 0) return map

      const rows = await db.all(sql(placeholders(list.length)), list)
      // A post without a slug is still reachable by id, so it resolves to
      // its id; the path helper does the same.
      for (const row of rows) map.set(Number(row.id), row.slug || String(row.id))
      return map
    }

    // The same visibility rules as the rest of the public API: `livePost` for
    // posts (published, not trashed, its time has come, not private), `livePage`
    // for pages. Categories have no visibility of their own.
    const targets: ResolvedTargets = {
      post: await lookup('post', list => `SELECT posts.id, posts.slug FROM posts WHERE posts.id IN (${list}) AND ${livePost('posts')}`),
      page: await lookup('page', list => `SELECT pages.id, pages.slug FROM pages WHERE pages.id IN (${list}) AND ${livePage('pages')}`),
      category: await lookup('category', list => `SELECT id, slug FROM categories WHERE id IN (${list})`)
    }

    const result: Record<string, PublicMenuItem[]> = {}
    for (const menu of menus) {
      result[menu.location] = buildPublicTree(items.filter(item => item.menu_id === menu.id), targets)
    }

    return result
  }
}
