import { useEffect } from 'react'
import { createClientApp, createThemeRegistry, ThemeProvider, useActiveTheme } from '@basicbenframework/core/client'
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
  import.meta.glob('../../themes/*/layouts/*.jsx')
)

const themeComponents = createThemeRegistry(
  import.meta.glob('../../themes/*/components/*.jsx')
)

/**
 * Load the active theme's stylesheet, and only that one.
 *
 * Imported the usual way, every installed theme's CSS would be in the bundle at
 * once — and because each theme declares its own `:root`, whichever happened to
 * load last would win no matter which theme is active. `?url` keeps them out of
 * the bundle and hands back a path instead, so exactly one theme's CSS is in the
 * document at a time and switching themes swaps it.
 */
const themeStyles = import.meta.glob('../../themes/*/styles/*.css', {
  query: '?url',
  import: 'default'
})

function ThemeStyles() {
  const { active } = useActiveTheme()

  useEffect(() => {
    if (!active) return

    let cancelled = false
    const added = []

    // variables.css before main.css: it declares the custom properties the
    // rest of the stylesheet reads.
    const paths = Object.keys(themeStyles)
      .filter(path => path.includes(`/themes/${active}/`))
      .sort((a, b) => Number(a.endsWith('main.css')) - Number(b.endsWith('main.css')))

    Promise.all(paths.map(path => themeStyles[path]())).then(urls => {
      if (cancelled) return
      for (const href of urls) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.dataset.themeStyle = active
        link.href = href
        document.head.appendChild(link)
        added.push(link)
      }
    })

    return () => {
      cancelled = true
      added.forEach(link => link.remove())
    }
  }, [active])

  return null
}

/** Wraps the app so any page can reach the active theme's components. */
const withThemes = ({ children }) => (
  <ThemeProvider layouts={themeLayouts} components={themeComponents} fallback="default">
    <ThemeStyles />
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
  }
})
