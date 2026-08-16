/**
 * Client-side theme resolution.
 *
 * ## Why this exists
 *
 * `ThemeManager` runs on the server and knows which theme is active, but a
 * theme's layouts are React components that render in the browser. Nothing
 * connected the two, which is why `themes/default/layouts/` sat inert: the
 * files were real components that no code path could ever reach.
 *
 * ## How a theme's components get into the bundle
 *
 * The browser cannot read the `themes/` directory, and a bundler cannot follow
 * an import path that is only known at runtime. `import.meta.glob` is the join:
 * the app declares the pattern at build time, Vite turns every match into a
 * lazily-loaded chunk, and this module picks the right one once the active
 * theme is known.
 *
 * Chunks are lazy rather than eager because themes accumulate. A site with six
 * installed themes should not ship six sets of layouts to every visitor to use
 * one of them.
 *
 * ## Falling back
 *
 * A theme need not implement every layout. Resolution walks the active theme,
 * then the fallback theme, then gives up and returns null so the caller can
 * render its own default. A missing layout is a gap in a theme, not an error.
 */

import React, { createContext, useContext, useEffect, useMemo, useState, Suspense } from 'react'
import { createThemeRegistry, resolveThemeSource } from './theme-registry.js'

// Re-exported so callers have one import for the whole theme surface. It lives
// in its own module because it needs no React, and the framework's tests run
// with nothing installed.
export { createThemeRegistry, parseThemePath, resolveThemeSource } from './theme-registry.js'

const ThemeRegistryContext = createContext(null)

/**
 * @typedef {Object} ThemeProviderProps
 * @property {Object} [layouts] - registry from createThemeRegistry
 * @property {Object} [components] - registry from createThemeRegistry
 * @property {string} [fallback] - theme to fall back to (default 'default')
 * @property {string} [active] - skip the fetch and use this slug
 * @property {string} [endpoint] - where to ask which theme is active
 * @property {import('react').ReactNode} [children]
 */

/**
 * Provide theme components to the tree.
 *
 * @param {ThemeProviderProps} props
 */
export function ThemeProvider({
  layouts = {},
  components = {},
  fallback = 'default',
  active: activeOverride,
  endpoint = '/api/themes/active',
  children
}) {
  const [active, setActive] = useState(activeOverride || null)

  useEffect(() => {
    if (activeOverride) return

    let cancelled = false

    // A theme that cannot be resolved is not worth failing the page over — the
    // fallback renders and the site stays up.
    fetch(endpoint)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancelled) return
        setActive(body?.theme?.slug || body?.slug || fallback)
      })
      .catch(() => {
        if (!cancelled) setActive(fallback)
      })

    return () => { cancelled = true }
  }, [activeOverride, endpoint, fallback])

  const value = useMemo(
    () => ({ layouts, components, active: active || fallback, fallback, resolved: active !== null }),
    [layouts, components, active, fallback]
  )

  return React.createElement(ThemeRegistryContext.Provider, { value }, children)
}

/**
 * The active theme's slug, and whether it has been determined yet.
 *
 * @returns {{ active: string, resolved: boolean }}
 */
export function useActiveTheme() {
  const context = useContext(ThemeRegistryContext)

  if (!context) return { active: null, resolved: false }

  return { active: context.active, resolved: context.resolved }
}

/** Cache of lazy components, so a remount does not re-create them. */
const lazyCache = new Map()

function resolve(registry, active, fallback, name) {
  const source = resolveThemeSource(registry, active, fallback, name)
  if (!source) return null

  const loader = registry[source][name]

  const key = `${registry === undefined ? '?' : ''}${active}:${fallback}:${name}`

  if (!lazyCache.has(key)) {
    // React.lazy expects a module with a default export. A theme file that
    // exports its component by name instead is accepted rather than failing at
    // render time, because that is an easy and forgivable mistake to make.
    lazyCache.set(key, React.lazy(async () => {
      const module = await loader()
      return { default: module.default || module[name] }
    }))
  }

  return lazyCache.get(key)
}

/**
 * Get a layout from the active theme.
 *
 * @param {string} name - e.g. 'PostLayout'
 * @returns {React.ComponentType|null} null when no theme provides it
 */
export function useThemeLayout(name) {
  const context = useContext(ThemeRegistryContext)

  return useMemo(() => {
    if (!context) return null
    return resolve(context.layouts, context.active, context.fallback, name)
  }, [context, name])
}

/**
 * Get a component from the active theme.
 *
 * @param {string} name - e.g. 'PostCard'
 * @returns {React.ComponentType|null}
 */
export function useThemeComponent(name) {
  const context = useContext(ThemeRegistryContext)

  return useMemo(() => {
    if (!context) return null
    return resolve(context.components, context.active, context.fallback, name)
  }, [context, name])
}

/**
 * @typedef {Object} ThemeLayoutOwnProps
 * @property {string} layout - the layout name to look for
 * @property {import('react').ReactNode} [fallback] - shown while the chunk loads
 * @property {(() => import('react').ReactNode)|import('react').ReactNode} [children] - used when no theme provides the layout
 */

/**
 * Render a themed layout, falling back to your own when no theme supplies one.
 *
 * Wraps the lazy component in Suspense so callers do not each have to.
 *
 * Any prop beyond `layout`, `fallback` and `children` is passed straight to
 * the theme's component — that is how a layout receives its posts, its title
 * and anything else it declares.
 *
 * @param {ThemeLayoutOwnProps & Record<string, any>} props
 */
export function ThemeLayout({ layout, fallback = null, children, ...rest }) {
  const Layout = useThemeLayout(layout)
  const { resolved } = useActiveTheme()

  // Rendering the fallback before the active theme is known would flash the
  // wrong layout and then swap it.
  if (!resolved) return fallback

  if (!Layout) {
    return typeof children === 'function' ? children() : (children ?? null)
  }

  return React.createElement(
    Suspense,
    { fallback },
    React.createElement(Layout, rest)
  )
}
