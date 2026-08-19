/**
 * Admin surface extension points.
 *
 * `admin.menu`, `admin.dashboard` and `admin.init` were declared as hooks and
 * fired by nothing, so there was no way to add a nav item or a dashboard
 * panel.
 *
 * They fire **here**, on the server, rather than in the React admin — which
 * matters more than it looks. The hook registry is a singleton per JavaScript
 * realm, and the browser is a different realm from the server. `src/hooks.ts`
 * is imported by the server entry, so its listeners are on that registry; a hook
 * fired in the browser would consult an empty one and find nothing. So the
 * admin UI asks the server what to render, and the server is where listeners are.
 */

import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { Post } from '../models/Post'
import { Page } from '../models/Page'
import { Comment } from '../models/Comment'
import { Media } from '../models/Media'
import type { Request, Response } from '../types'

/** The menu the admin ships with. Listeners filter it, they do not replace it. */
const DEFAULT_MENU = [
  { path: '/admin', label: 'Dashboard', icon: '📊' },
  { path: '/admin/posts', label: 'Posts', icon: '📝' },
  { path: '/admin/pages', label: 'Pages', icon: '📄' },
  { path: '/admin/categories', label: 'Categories', icon: '📁' },
  { path: '/admin/tags', label: 'Tags', icon: '🏷️' },
  { path: '/admin/comments', label: 'Comments', icon: '💬' },
  { path: '/admin/media', label: 'Media', icon: '🖼️' },
  { path: '/admin/tokens', label: 'API tokens', icon: '🔑' },
  // Where an author edits their own byline. It lives outside /admin because it
  // is the one screen every account has, admin area or not — but the people
  // writing posts are in here, so the way to it has to be too.
  { path: '/profile', label: 'Profile', icon: '👤' },
  { path: '/admin/settings', label: 'Settings', icon: '⚙️' }
]

interface MenuItem {
  path: string
  label: string
  icon?: string
}

export const AdminController = {
  /**
   * The admin navigation, after listeners have had their say.
   *
   * @example
   * hooks.on('admin.menu', (items) => [
   *   ...items,
   *   { path: '/admin/seo', label: 'SEO', icon: '🔍' }
   * ])
   */
  async menu(req: Request, res: Response) {
    const items = await hooks.filter(HOOKS.ADMIN_MENU, [...DEFAULT_MENU], { req })

    // A listener that returns something that is not a list should not blank the
    // navigation — it should be ignored.
    const menu = Array.isArray(items) ? items : DEFAULT_MENU

    res.json({
      menu: menu.filter(
        (item: MenuItem) => item && typeof item.path === 'string' && typeof item.label === 'string'
      )
    })
  },

  /**
   * Dashboard statistics, and any panels listeners contribute.
   *
   * @example
   * hooks.on('admin.dashboard', (data) => ({
   *   ...data,
   *   panels: [...data.panels, { title: 'Search', body: '…' }]
   * }))
   */
  async dashboard(req: Request, res: Response) {
    const [posts, pages, pendingComments, mediaStats] = await Promise.all([
      Post.findByUser(req.userId as number),
      Page.all(),
      Comment.countPending(),
      Media.getStats()
    ])

    const data = await hooks.filter(HOOKS.ADMIN_DASHBOARD, {
      stats: {
        posts: posts.length,
        pages: pages.length,
        pendingComments,
        media: mediaStats?.total ?? 0
      },
      recentPosts: posts.slice(0, 5),
      panels: [] as Array<Record<string, unknown>>
    }, { req })

    res.json(data)
  },

  /**
   * Fired once when the admin UI boots, so a listener can register or warm
   * anything it needs before the first screen renders.
   */
  async init(req: Request, res: Response) {
    await hooks.fire(HOOKS.ADMIN_INIT, { userId: req.userId, req })

    res.json({ ok: true })
  }
}
