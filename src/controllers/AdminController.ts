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

/**
 * The menu the admin ships with. Listeners filter it, they do not replace it.
 *
 * `section` is the heading an item sits under in the sidebar. Ten flat links
 * read as a list to be scanned; grouped, the shape of the admin is visible from
 * the nav — what you write, what you configure, and what is yours. An item
 * without a section sits at the top with the dashboard.
 *
 * The client keeps an identical copy as its fallback, and a test fails when the
 * two disagree — a difference is not a fallback, it is a flicker on every
 * navigation.
 */
const DEFAULT_MENU = [
  { path: '/admin', label: 'Dashboard', icon: '📊' },
  { path: '/admin/posts', label: 'Posts', icon: '📝', section: 'Content' },
  { path: '/admin/pages', label: 'Pages', icon: '📄', section: 'Content' },
  { path: '/admin/categories', label: 'Categories', icon: '📁', section: 'Content' },
  { path: '/admin/tags', label: 'Tags', icon: '🏷️', section: 'Content' },
  { path: '/admin/comments', label: 'Comments', icon: '💬', section: 'Content' },
  { path: '/admin/media', label: 'Media', icon: '🖼️', section: 'Content' },
  { path: '/admin/tokens', label: 'API tokens', icon: '🔑', section: 'Site' },
  { path: '/admin/settings', label: 'Settings', icon: '⚙️', section: 'Site' },
  // Where an author edits their own byline. It lives outside /admin because it
  // is the one screen every account has, admin area or not — but the people
  // writing posts are in here, so the way to it has to be too.
  { path: '/profile', label: 'Profile', icon: '👤', section: 'Account' }
]

interface MenuItem {
  path: string
  label: string
  icon?: string
  /** The heading it sits under. Omitted items sit at the top, ungrouped. */
  section?: string
}

export const AdminController = {
  /**
   * The admin navigation, after listeners have had their say.
   *
   * @example
   * hooks.on('admin.menu', (items) => [
   *   ...items,
   *   { path: '/admin/seo', label: 'SEO', icon: '🔍', section: 'Site' }
   * ])
   *
   * An item joins the section it names, wherever in the list it is added, and
   * creates that heading if it is a new one. Leave `section` off and it sits at
   * the top beside the dashboard.
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
