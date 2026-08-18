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
export function useAuth<T = any>(): {
    user: T | null;
    setUser: (user: T | null) => void;
    logout: () => void;
    loading: boolean;
};
/**
 * Get navigation function
 * @returns {(to: string, options?: { replace?: boolean }) => void} navigate(path, options)
 */
export function useNavigate(): (to: string, options?: {
    replace?: boolean;
}) => void;
/**
 * Get current route params
 * @returns {Record<string, string>} params object (e.g. { id: '123' })
 */
export function useParams(): Record<string, string>;
/**
 * Get current path
 * @returns {string} current pathname
 */
export function usePath(): string;
