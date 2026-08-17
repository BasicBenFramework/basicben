/**
 * Admin surface extension points.
 *
 * `admin.menu`, `admin.dashboard` and `admin.init` were declared as hooks and
 * fired by nothing, so a plugin had no way to add a nav item or a dashboard
 * panel.
 *
 * They fire **here**, on the server, rather than in the React admin — which
 * matters more than it looks. The hook registry is a singleton per JavaScript
 * realm, and the browser is a different realm from the server. A plugin loaded
 * from `plugins/` registers its callbacks in the server's registry; a hook
 * fired in the browser would consult an empty one and find nothing. So the
 * admin UI asks the server what to render, and the server is where plugins are.
 */

import { hooks, HOOKS } from '@basicbenframework/core/hooks'
import { Post } from '../models/Post'
import { Page } from '../models/Page'
import { Comment } from '../models/Comment'
import { Media } from '../models/Media'
import type { Request, Response } from '../types'

/** The menu the admin ships with. Plugins filter this, they do not replace it. */
const DEFAULT_MENU = [
  { path: '/admin', label: 'Dashboard', icon: '📊' },
  { path: '/admin/posts', label: 'Posts', icon: '📝' },
  { path: '/admin/pages', label: 'Pages', icon: '📄' },
  { path: '/admin/categories', label: 'Categories', icon: '📁' },
  { path: '/admin/tags', label: 'Tags', icon: '🏷️' },
  { path: '/admin/comments', label: 'Comments', icon: '💬' },
  { path: '/admin/media', label: 'Media', icon: '🖼️' },
  { path: '/admin/plugins', label: 'Plugins', icon: '🔌' },
  { path: '/admin/settings', label: 'Settings', icon: '⚙️' }
]

interface MenuItem {
  path: string
  label: string
  icon?: string
}

export const AdminController = {
  /**
   * The admin navigation, after plugins have had their say.
   *
   * @example
   * hooks.on('admin.menu', (items) => [
   *   ...items,
   *   { path: '/admin/seo', label: 'SEO', icon: '🔍' }
   * ])
   */
  async menu(req: Request, res: Response) {
    const items = await hooks.filter(HOOKS.ADMIN_MENU, [...DEFAULT_MENU], { req })

    // A plugin that returns something that is not a list should not blank the
    // navigation — it should be ignored.
    const menu = Array.isArray(items) ? items : DEFAULT_MENU

    res.json({
      menu: menu.filter(
        (item: MenuItem) => item && typeof item.path === 'string' && typeof item.label === 'string'
      )
    })
  },

  /**
   * Dashboard statistics, and any panels plugins contribute.
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
   * Fired once when the admin UI boots, so a plugin can register or warm
   * anything it needs before the first screen renders.
   */
  async init(req: Request, res: Response) {
    await hooks.fire(HOOKS.ADMIN_INIT, { userId: req.userId, req })

    res.json({ ok: true })
  }
}
