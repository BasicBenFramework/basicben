import {
  Menu,
  validateMenuItem,
  validateReorder,
  LOCATION_PATTERN,
  BUILT_IN_LOCATIONS,
  type MenuItemRow
} from '../models/Menu.ts'
import type { Request, Response } from '../types/index.ts'

/**
 * Navigation menus: admin management and the public read.
 *
 * The admin routes require `settings.manage` — what appears in the site's
 * header is a site-wide decision, like the site's name, and it is the
 * capability WordPress's equivalent (`edit_theme_options`) maps to here.
 */

function validateMenu(body: Record<string, unknown>):
  | { values: { name: string; location: string } }
  | { errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {}
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const location = typeof body.location === 'string' ? body.location.trim() : ''

  if (name === '' || name.length > 100) errors.name = ['Name is required (at most 100 characters)']
  if (!LOCATION_PATTERN.test(location)) {
    errors.location = ['Lowercase letters, digits, - and _, starting with a letter']
  }

  return Object.keys(errors).length ? { errors } : { values: { name, location } }
}

const intParam = (value: string | undefined) => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * The relationship checks `validateMenuItem` cannot make without the database:
 * the target exists, and the parent is a top-level item of the same menu.
 */
async function checkRelations(
  menuId: number,
  values: { parent_id: number | null; target_type: MenuItemRow['target_type']; target_id: number | null },
  itemId?: number
): Promise<Record<string, string[]> | null> {
  if (values.target_type && values.target_id && !(await Menu.targetExists(values.target_type, values.target_id))) {
    return { target_id: [`That ${values.target_type} does not exist`] }
  }

  if (values.parent_id !== null) {
    if (values.parent_id === itemId) return { parent_id: ['An item cannot be its own parent'] }

    const parent = await Menu.findItem(values.parent_id)
    if (!parent || Number(parent.menu_id) !== menuId) return { parent_id: ['Parent must be in the same menu'] }
    if (parent.parent_id) return { parent_id: ['Items can be nested one level deep'] }

    // An item with children of its own cannot become a child.
    if (itemId && (await Menu.items(menuId)).some(item => Number(item.parent_id) === itemId)) {
      return { parent_id: ['Move this item\'s children out first; menus nest one level deep'] }
    }
  }

  return null
}

export const NavigationController = {
  /** Every menu with its items, flat and in order; the admin builds the tree. */
  async index(_req: Request, res: Response) {
    const menus = await Menu.all()
    const withItems = await Promise.all(menus.map(async menu => ({ ...menu, items: await Menu.items(menu.id) })))

    res.json({ menus: withItems })
  },

  async storeMenu(req: Request, res: Response) {
    const result = validateMenu(req.body)
    if ('errors' in result) return res.json({ errors: result.errors }, 422)

    if (await Menu.findByLocation(result.values.location)) {
      return res.json({ errors: { location: ['A menu already uses this location'] } }, 422)
    }

    const menu = await Menu.create(result.values)
    res.json({ menu: { ...menu, items: [] } }, 201)
  },

  async updateMenu(req: Request, res: Response) {
    const id = intParam(req.params.id)
    const menu = id ? await Menu.find(id) : undefined
    if (!menu) return res.json({ error: 'Menu not found' }, 404)

    const result = validateMenu({ ...menu, ...req.body })
    if ('errors' in result) return res.json({ errors: result.errors }, 422)

    // A front end hard-codes the built-in locations; renaming one away would
    // empty its header with no error anywhere.
    if (BUILT_IN_LOCATIONS.includes(menu.location) && result.values.location !== menu.location) {
      return res.json({ errors: { location: ['Built-in locations cannot be changed'] } }, 422)
    }

    const clash = await Menu.findByLocation(result.values.location)
    if (clash && clash.id !== menu.id) {
      return res.json({ errors: { location: ['A menu already uses this location'] } }, 422)
    }

    res.json({ menu: await Menu.update(menu.id, result.values) })
  },

  async destroyMenu(req: Request, res: Response) {
    const id = intParam(req.params.id)
    const menu = id ? await Menu.find(id) : undefined
    if (!menu) return res.json({ error: 'Menu not found' }, 404)

    if (BUILT_IN_LOCATIONS.includes(menu.location)) {
      return res.json({ error: 'Built-in menus cannot be deleted. Remove their items instead.' }, 422)
    }

    await Menu.delete(menu.id)
    res.json({ message: 'Menu deleted' })
  },

  async storeItem(req: Request, res: Response) {
    const menuId = intParam(req.params.id)
    const menu = menuId ? await Menu.find(menuId) : undefined
    if (!menu) return res.json({ error: 'Menu not found' }, 404)

    const result = validateMenuItem(req.body)
    if ('errors' in result) return res.json({ errors: result.errors }, 422)

    const relationErrors = await checkRelations(menu.id, result.values)
    if (relationErrors) return res.json({ errors: relationErrors }, 422)

    const item = await Menu.createItem(menu.id, {
      ...result.values,
      sort_order: result.values.sort_order ?? (await Menu.nextSortOrder(menu.id, result.values.parent_id))
    })

    res.json({ item }, 201)
  },

  async updateItem(req: Request, res: Response) {
    const id = intParam(req.params.id)
    const existing = id ? await Menu.findItem(id) : undefined
    if (!existing) return res.json({ error: 'Menu item not found' }, 404)

    // Fields the request leaves out keep their values. A request that names
    // a target clears the URL and vice versa — see validateMenuItem.
    const merged: Record<string, unknown> = { ...existing, ...req.body }
    if ('url' in req.body && !('target_type' in req.body)) merged.target_type = null

    const result = validateMenuItem(merged)
    if ('errors' in result) return res.json({ errors: result.errors }, 422)

    const relationErrors = await checkRelations(Number(existing.menu_id), result.values, existing.id)
    if (relationErrors) return res.json({ errors: relationErrors }, 422)

    const item = await Menu.updateItem(existing.id, {
      ...result.values,
      sort_order: result.values.sort_order ?? existing.sort_order
    })

    res.json({ item })
  },

  async destroyItem(req: Request, res: Response) {
    const id = intParam(req.params.id)
    const existing = id ? await Menu.findItem(id) : undefined
    if (!existing) return res.json({ error: 'Menu item not found' }, 404)

    // Its children go with it — they were a dropdown under it.
    await Menu.deleteItem(existing.id)
    res.json({ message: 'Menu item deleted' })
  },

  async reorder(req: Request, res: Response) {
    const menuId = intParam(req.params.id)
    const menu = menuId ? await Menu.find(menuId) : undefined
    if (!menu) return res.json({ error: 'Menu not found' }, 404)

    const existing = await Menu.items(menu.id)
    const result = validateReorder((req.body as { items?: unknown }).items, existing.map(item => Number(item.id)))
    if ('error' in result) return res.json({ errors: { items: [result.error] } }, 422)

    await Menu.reorder(result.order)
    res.json({ items: await Menu.items(menu.id) })
  },

  /**
   * `GET /api/v1/navigation` — every menu by location, or one with
   * `?location=primary`.
   *
   * Linked content comes back as its current site-relative path, and is left
   * out when a visitor could not open it. Each item also carries its target's
   * id and slug, for a front end whose URL scheme differs from the CMS's
   * default (`/blog/:slug`, `/:slug`, `/category/:slug`).
   */
  async publicIndex(req: Request, res: Response) {
    const location = typeof req.query.location === 'string' ? req.query.location : undefined

    if (location !== undefined && !LOCATION_PATTERN.test(location)) {
      return res.json({ error: 'Not found' }, 404)
    }

    const menus = await Menu.publicNavigation(location)

    if (location !== undefined) {
      if (!(location in menus)) return res.json({ error: 'Not found' }, 404)
      return res.json({ data: menus[location] })
    }

    res.json({ data: menus })
  }
}
