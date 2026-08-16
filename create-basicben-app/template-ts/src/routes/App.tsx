import { createClientApp, createThemeRegistry, ThemeProvider } from '@basicbenframework/core/client'
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
import { Plugins } from '../client/pages/Plugins'
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
import AdminThemes from '../client/pages/admin/Themes'
import AdminPlugins from '../client/pages/admin/Plugins'
import AdminSettings from '../client/pages/admin/Settings'

// Admin layout wrapper (no default layout)
const NoLayout = ({ children }: { children: React.ReactNode }) => <>{children}</>

/**
 * Discover every installed theme's React components.
 *
 * The browser cannot read the themes/ directory and a bundler cannot follow an
 * import path only known at runtime, so the pattern is declared here at build
 * time. Vite turns each match into its own lazily-loaded chunk, and the active
 * theme decides which one is fetched — a site with six themes installed does
 * not ship six sets of layouts to every visitor.
 */
const themeLayouts = createThemeRegistry(
  import.meta.glob('../../themes/*/layouts/*.tsx')
)

const themeComponents = createThemeRegistry(
  import.meta.glob('../../themes/*/components/*.tsx')
)

/** Wraps the app so any page can reach the active theme's components. */
const withThemes = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider layouts={themeLayouts} components={themeComponents} fallback="default">
    {children}
  </ThemeProvider>
)

export default createClientApp({
  provider: withThemes,
  layout: AppLayout,
  routes: {
    '/': Home,
    '/login': { component: Auth, layout: AuthLayout, guest: true },
    '/register': { component: Auth, layout: AuthLayout, guest: true },
    '/feed': Feed,
    '/feed/:id': FeedPost,
    '/posts': { component: Posts, auth: true },
    '/posts/new': { component: PostForm, auth: true },
    '/posts/:id/edit': { component: PostForm, auth: true },
    '/profile': { component: Profile, auth: true },
    '/docs': { component: GettingStarted, layout: DocsLayout },
    '/docs/routing': { component: Routing, layout: DocsLayout },
    '/docs/database': { component: Database, layout: DocsLayout },
    '/docs/authentication': { component: Authentication, layout: DocsLayout },
    '/docs/validation': { component: Validation, layout: DocsLayout },
    '/docs/content': { component: Content, layout: DocsLayout },
    '/docs/storage': { component: Storage, layout: DocsLayout },
    '/docs/plugins': { component: Plugins, layout: DocsLayout },
    '/docs/testing': { component: Testing, layout: DocsLayout },

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
    '/admin/themes': { component: AdminThemes, layout: NoLayout, auth: true },
    '/admin/plugins': { component: AdminPlugins, layout: NoLayout, auth: true },
    '/admin/settings': { component: AdminSettings, layout: NoLayout, auth: true },
  }
})
