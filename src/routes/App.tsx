import { createClientApp } from '@basicbenframework/core/client'

/**
 * Mirrors the framework's RouteDefinition, which its client entry point does
 * not re-export. Declared here only so the conditional route maps below can be
 * annotated: without an annotation TypeScript widens every key of a spread
 * conditional to `Type | undefined`, which the router's own signature refuses.
 */
type RouteDefinition =
  | React.ComponentType<any>
  | {
      component: React.ComponentType<any>
      auth?: boolean
      guest?: boolean
      layout?: React.ComponentType<any> | null
    }
import { AppLayout } from '../client/layouts/AppLayout'
import { AuthLayout } from '../client/layouts/AuthLayout'
import { DocsLayout } from '../client/layouts/DocsLayout'
import { Home } from '../client/pages/Home'
import { Auth } from '../client/pages/Auth'
import { Feed } from '../client/pages/Feed'
import { FeedPost } from '../client/pages/FeedPost'
import { Posts } from '../client/pages/Posts'
import { PostForm } from '../client/pages/PostForm'
import { Profile } from '../client/pages/Profile'
import { GettingStarted } from '../client/pages/GettingStarted'
import { Database } from '../client/pages/Database'
import { Routing } from '../client/pages/Routing'
import { Authentication } from '../client/pages/Authentication'
import { Validation } from '../client/pages/Validation'
import { Content } from '../client/pages/Content'
import { Storage } from '../client/pages/Storage'
import { Extending } from '../client/pages/Extending'
import { Headless } from '../client/pages/Headless'
import { Testing } from '../client/pages/Testing'

// Admin pages
import AdminDashboard from '../client/pages/admin/Dashboard'
import AdminPosts from '../client/pages/admin/Posts'
import AdminPostEditor from '../client/pages/admin/PostEditor'
import AdminPages from '../client/pages/admin/Pages'
import AdminCategories from '../client/pages/admin/Categories'
import AdminTags from '../client/pages/admin/Tags'
import AdminComments from '../client/pages/admin/Comments'
import AdminMedia from '../client/pages/admin/Media'
import AdminTokens from '../client/pages/admin/Tokens'
import AdminSettings from '../client/pages/admin/Settings'

// Admin layout wrapper (no default layout)
const NoLayout = ({ children }: { children: React.ReactNode }) => <>{children}</>

/**
 * The public site: the marketing page, the built-in blog, and the framework
 * documentation. Present unless DISABLE_PUBLIC_SITE is set, which is how you
 * run this purely as a backend for something else — the admin and the content
 * API, with nothing for a visitor to land on.
 *
 * `__DISABLE_PUBLIC_SITE__` is a build-time constant, so these routes and the
 * pages they name are dropped from the bundle rather than merely unreachable.
 */
const publicRoutes: Record<string, RouteDefinition> = __DISABLE_PUBLIC_SITE__
  ? {}
  : {
      '/': Home,
      '/feed': Feed,
      '/feed/:id': FeedPost,
      '/docs': { component: GettingStarted, layout: DocsLayout },
      '/docs/routing': { component: Routing, layout: DocsLayout },
      '/docs/database': { component: Database, layout: DocsLayout },
      '/docs/authentication': { component: Authentication, layout: DocsLayout },
      '/docs/validation': { component: Validation, layout: DocsLayout },
      '/docs/content': { component: Content, layout: DocsLayout },
      '/docs/storage': { component: Storage, layout: DocsLayout },
      '/docs/extending': { component: Extending, layout: DocsLayout },
      '/docs/headless': { component: Headless, layout: DocsLayout },
      '/docs/testing': { component: Testing, layout: DocsLayout }
    }

/**
 * Signing in is always reachable; signing *up* is not.
 *
 * With DISABLE_REGISTRATION the route goes, so the form cannot be reached by
 * typing the URL either. The server refuses the request regardless — see
 * AuthController.register — because a missing route is presentation and this
 * needs to be a control.
 */
const authRoutes: Record<string, RouteDefinition> = {
  '/login': { component: Auth, layout: AuthLayout, guest: true },
  ...(__DISABLE_REGISTRATION__
    ? {}
    : { '/register': { component: Auth, layout: AuthLayout, guest: true } })
}

export default createClientApp({
  layout: AppLayout,
  routes: {
    ...publicRoutes,
    ...authRoutes,

    // With no public site, `/` would otherwise 404 for someone who simply
    // opened the domain, so it points at the admin instead.
    //
    // `auth: true` and not `guest: true`, which is what this was first and was
    // wrong: the router sends a signed-in visitor away from a guest route by
    // navigating to `/`, so making `/` itself a guest route looped it against
    // itself and rendered nothing. A blank page, only once you were logged in.
    //
    // As an auth route it works from both sides — the same guard sends a
    // signed-out visitor to /login, and a signed-in one lands where they were
    // going anyway.
    ...(__DISABLE_PUBLIC_SITE__
      ? { '/': { component: AdminDashboard, layout: NoLayout, auth: true } }
      : {}),

    '/posts': { component: Posts, auth: true },
    '/posts/new': { component: PostForm, auth: true },
    '/posts/:id/edit': { component: PostForm, auth: true },
    '/profile': { component: Profile, auth: true },

    // Admin routes (use their own layout)
    '/admin': { component: AdminDashboard, layout: NoLayout, auth: true },
    '/admin/posts': { component: AdminPosts, layout: NoLayout, auth: true },
    '/admin/posts/new': { component: AdminPostEditor, layout: NoLayout, auth: true },
    '/admin/posts/:id/edit': { component: AdminPostEditor, layout: NoLayout, auth: true },
    '/admin/pages': { component: AdminPages, layout: NoLayout, auth: true },
    '/admin/pages/new': { component: AdminPostEditor, layout: NoLayout, auth: true },
    '/admin/pages/:id/edit': { component: AdminPostEditor, layout: NoLayout, auth: true },
    '/admin/categories': { component: AdminCategories, layout: NoLayout, auth: true },
    '/admin/tags': { component: AdminTags, layout: NoLayout, auth: true },
    '/admin/comments': { component: AdminComments, layout: NoLayout, auth: true },
    '/admin/media': { component: AdminMedia, layout: NoLayout, auth: true },
    '/admin/tokens': { component: AdminTokens, layout: NoLayout, auth: true },
    '/admin/settings': { component: AdminSettings, layout: NoLayout, auth: true },
  }
})
