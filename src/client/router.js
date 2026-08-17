import { useState, useEffect, useCallback, createElement } from 'react'
import { RouterContext, AuthContext } from './context.js'

/**
 * A route entry: either the component itself, or the component plus its guards.
 *
 * @typedef {import('react').ComponentType<any> | {
 *   component: import('react').ComponentType<any>,
 *   auth?: boolean,
 *   guest?: boolean,
 *   layout?: import('react').ComponentType<any> | null
 * }} RouteDefinition
 */

/**
 * Create a client-side React app with routing
 *
 * @param {object} config
 * @param {Record<string, RouteDefinition>} config.routes - Route definitions { path: Component | { component, auth?, guest?, layout? } }
 * @param {import('react').ComponentType<any>} [config.layout] - Default layout wrapper
 * @param {(path: string) => Promise<any>} [config.api] - API function for auth check (default: fetch /api/user)
 * @param {import('react').ComponentType<any>} [config.Loading] - Loading component
 * @param {import('react').ComponentType<any>} [config.NotFound] - Component rendered when no route matches.
 *   Receives no props and is wrapped in the default layout, so an unmatched path
 *   keeps the site's navigation instead of rendering a bare string.
 * @param {import('react').ComponentType<{children: any}>} [config.provider] - Wraps the
 *   entire tree, outside the auth and router contexts. Use it for anything every
 *   route needs and that must survive navigation — a query client, a data
 *   cache, an error boundary.
 * @returns {import('react').FunctionComponent} React component
 */
export function createClientApp(config) {
  const { routes, layout: DefaultLayout, api, Loading, NotFound, provider: Provider } = config

  // Normalize routes to consistent format
  const normalizedRoutes = Object.entries(routes).map(([path, value]) => {
    const isSimple = typeof value === 'function'
    return {
      path,
      pattern: pathToRegex(path),
      component: isSimple ? value : value.component,
      auth: isSimple ? false : value.auth || false,
      guest: isSimple ? false : value.guest || false,
      layout: isSimple ? null : value.layout || null,
    }
  })

  function App() {
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const [path, setPath] = useState(window.location.pathname)

    // Match current route
    const matchRoute = useCallback((pathname) => {
      for (const route of normalizedRoutes) {
        const match = pathname.match(route.pattern)
        if (match) {
          const routeParams = extractParams(route.path, match)
          return { route, params: routeParams }
        }
      }
      return null
    }, [])

    // Navigate function
    const navigate = useCallback((to, options = {}) => {
      const { replace = false } = options

      if (replace) {
        window.history.replaceState({}, '', to)
      } else {
        window.history.pushState({}, '', to)
      }

      setPath(to)
      window.scrollTo(0, 0)
    }, [])

    // Logout function
    const logout = useCallback(() => {
      localStorage.removeItem('token')
      setUser(null)
      navigate('/')
    }, [navigate])

    // Auth check on mount
    useEffect(() => {
      const token = localStorage.getItem('token')
      if (!token) {
        setLoading(false)
        return
      }

      const checkAuth = api || defaultApi
      checkAuth('/api/user')
        .then(data => setUser(data.user))
        .catch(() => localStorage.removeItem('token'))
        .finally(() => setLoading(false))
    }, [])

    // Handle browser back/forward
    useEffect(() => {
      const handlePopState = () => {
        setPath(window.location.pathname)
      }
      window.addEventListener('popstate', handlePopState)
      return () => window.removeEventListener('popstate', handlePopState)
    }, [])

    // Loading state
    if (loading) {
      if (Loading) return createElement(Loading)
      return createElement('div', {
        style: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }
      }, 'Loading...')
    }

    // Find matching route
    const matched = matchRoute(path)

    let wrapped
    let params = {}

    if (!matched) {
      if (!NotFound) {
        return createElement('div', null, '404 - Not Found')
      }
      // Falls through to the providers below rather than returning here, so the
      // page and its layout can use useAuth/useNavigate/usePath like any other.
      wrapped = createElement(NotFound)
      if (DefaultLayout) {
        wrapped = createElement(DefaultLayout, null, wrapped)
      }
    } else {
      const { route, params: routeParams } = matched
      params = routeParams

      // Route guards
      if (route.auth && !user) {
        navigate('/login', { replace: true })
        return null
      }
      if (route.guest && user) {
        navigate('/', { replace: true })
        return null
      }

      wrapped = createElement(route.component)

      // Route-specific layout replaces the default
      const Layout = route.layout || DefaultLayout
      if (Layout) {
        wrapped = createElement(Layout, null, wrapped)
      }
    }

    // Provide context
    const tree = createElement(
      AuthContext.Provider,
      { value: { user, setUser, logout, loading } },
      createElement(
        RouterContext.Provider,
        { value: { path, params, navigate } },
        wrapped
      )
    )

    // An app-supplied wrapper goes outside both, so anything it provides is
    // available to every route and every layout — a store, a query
    // client, an error boundary. Outside rather than inside because a provider
    // that only covered the matched route would remount on every navigation.
    return Provider ? createElement(Provider, null, tree) : tree
  }

  return App
}

/**
 * Convert route path to regex
 * /posts/:id -> /^\/posts\/([^/]+)$/
 */
function pathToRegex(path) {
  if (path === '*') return /^.*$/

  const pattern = path
    .replace(/\*/g, '.*')
    .replace(/:(\w+)/g, '([^/]+)')
    .replace(/\//g, '\\/')

  return new RegExp(`^${pattern}$`)
}

/**
 * Extract params from match
 */
function extractParams(path, match) {
  const params = {}
  const paramNames = path.match(/:(\w+)/g) || []

  paramNames.forEach((name, i) => {
    params[name.slice(1)] = match[i + 1]
  })

  return params
}

/**
 * Default API function
 */
async function defaultApi(path) {
  const token = localStorage.getItem('token')
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  if (!res.ok) throw new Error('Request failed')
  return res.json()
}
