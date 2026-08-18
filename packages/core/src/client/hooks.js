import { useContext } from 'react'
import { RouterContext, AuthContext } from './context.js'

/**
 * Access auth state and methods
 *
 * The user record is whatever the auth endpoint returns, so its shape is the
 * application's to declare: `useAuth<User>()` types it, and calling with no
 * type argument leaves it unconstrained rather than wrong.
 *
 * @template [T=any] the application's user record
 * @returns {{ user: T|null, setUser: (user: T|null) => void, logout: () => void, loading: boolean }}
 */
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within createClientApp')
  }
  return context
}

/**
 * Get navigation function
 * @returns {(to: string, options?: { replace?: boolean }) => void} navigate(path, options)
 */
export function useNavigate() {
  const context = useContext(RouterContext)
  if (!context) {
    throw new Error('useNavigate must be used within createClientApp')
  }
  return context.navigate
}

/**
 * Get current route params
 * @returns {Record<string, string>} params object (e.g. { id: '123' })
 */
export function useParams() {
  const context = useContext(RouterContext)
  if (!context) {
    throw new Error('useParams must be used within createClientApp')
  }
  return context.params
}

/**
 * Get current path
 * @returns {string} current pathname
 */
export function usePath() {
  const context = useContext(RouterContext)
  if (!context) {
    throw new Error('usePath must be used within createClientApp')
  }
  return context.path
}
