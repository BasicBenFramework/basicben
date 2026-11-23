import { Redirect, validateRedirect } from '../models/Redirect'
import { paginationFrom, meta } from '../models/pagination'
import { normalizeRedirectSource } from '../helpers/content-paths'
import type { Request, Response } from '../types'

/**
 * Redirect management for the admin, and the public lookup for front ends.
 *
 * The admin routes require `settings.manage`. A redirect can send every
 * visitor of any path anywhere on the web, which is a site-wide decision of
 * the same weight as the site's settings, not an editorial one.
 */
export const RedirectController = {
  async index(req: Request, res: Response) {
    const { page, perPage, offset } = paginationFrom(req.query as Record<string, string>)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 200) : ''

    const { redirects, total } = await Redirect.paginate({ perPage, offset, search: search || undefined })

    res.json({ redirects, meta: meta(page, perPage, total) })
  },

  async store(req: Request, res: Response) {
    const result = validateRedirect(req.body)
    if ('errors' in result) return res.json({ errors: result.errors }, 422)

    const { from_path, to_path } = result.values

    if (await Redirect.findByPath(from_path)) {
      return res.json({ errors: { from_path: ['A redirect from this path already exists'] } }, 422)
    }

    if (await Redirect.wouldLoop(from_path, to_path)) {
      return res.json({ errors: { to_path: ['This would create a redirect loop'] } }, 422)
    }

    const redirect = await Redirect.save(result.values, 'manual')
    res.json({ redirect }, 201)
  },

  async update(req: Request, res: Response) {
    const id = Number(req.params.id)
    const existing = Number.isInteger(id) ? await Redirect.find(id) : undefined

    if (!existing) return res.json({ error: 'Redirect not found' }, 404)

    const result = validateRedirect({ ...existing, ...req.body })
    if ('errors' in result) return res.json({ errors: result.errors }, 422)

    const { from_path, to_path } = result.values
    const clash = await Redirect.findByPath(from_path)

    if (clash && clash.id !== id) {
      return res.json({ errors: { from_path: ['A redirect from this path already exists'] } }, 422)
    }

    if (await Redirect.wouldLoop(from_path, to_path, id)) {
      return res.json({ errors: { to_path: ['This would create a redirect loop'] } }, 422)
    }

    const redirect = await Redirect.update(id, result.values)
    res.json({ redirect })
  },

  async destroy(req: Request, res: Response) {
    const id = Number(req.params.id)
    const existing = Number.isInteger(id) ? await Redirect.find(id) : undefined

    if (!existing) return res.json({ error: 'Redirect not found' }, 404)

    await Redirect.delete(id)
    res.json({ message: 'Redirect deleted' })
  },

  /**
   * `GET /api/v1/redirects` — the whole map, or one path with `?path=`.
   *
   * The list is the primary interface. A headless front end applies redirects
   * itself, and the sensible places to do that — a build step writing a
   * `_redirects` / `vercel.json` file, or edge middleware holding the map in
   * memory — want every rule at once. Asking per path would put an API round
   * trip in front of every request the front end cannot otherwise answer. The
   * list is ETag-cached like every v1 read, so re-fetching an unchanged map
   * costs a 304.
   *
   * `?path=` is there for front ends that only consult the CMS on a 404 (a
   * catch-all route). It returns 404 when nothing matches, and counts a hit
   * when something does.
   *
   * Chains are resolved either way: `to` is always the final destination.
   */
  async publicIndex(req: Request, res: Response) {
    const present = (row: { from_path: string; to_path: string; status: number }) => ({
      from: row.from_path,
      to: row.to_path,
      status: Number(row.status)
    })

    if (req.query.path !== undefined) {
      const path = normalizeRedirectSource(req.query.path)
      if (!path) return res.json({ error: 'Not found' }, 404)

      const match = await Redirect.lookup(path)
      if (!match) return res.json({ error: 'Not found' }, 404)

      await Redirect.hit(match.id)

      return res.json({ data: present(match) })
    }

    const rows = await Redirect.allResolved()
    res.json({ data: rows.map(present), meta: { total: rows.length } })
  }
}
