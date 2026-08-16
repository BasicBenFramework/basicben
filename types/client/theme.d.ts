/**
 * Index the modules produced by `import.meta.glob`.
 *
 * @param {Object} modules - path → () => Promise<Module>, from import.meta.glob
 * @param {Object} [options]
 * @param {string} [options.kind] - 'layouts' or 'components'
 * @returns {Object} registry keyed by theme slug then component name
 *
 * @example
 * const layouts = createThemeRegistry(
 *   import.meta.glob('../../themes/[*]\/layouts/[*].tsx')
 * )
 */
export function createThemeRegistry(modules?: any): any;
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
export function ThemeProvider({ layouts, components, fallback, active: activeOverride, endpoint, children }: ThemeProviderProps): React.FunctionComponentElement<React.ProviderProps<any>>;
/**
 * The active theme's slug, and whether it has been determined yet.
 *
 * @returns {{ active: string, resolved: boolean }}
 */
export function useActiveTheme(): {
    active: string;
    resolved: boolean;
};
/**
 * Get a layout from the active theme.
 *
 * @param {string} name - e.g. 'PostLayout'
 * @returns {React.ComponentType|null} null when no theme provides it
 */
export function useThemeLayout(name: string): React.ComponentType | null;
/**
 * Get a component from the active theme.
 *
 * @param {string} name - e.g. 'PostCard'
 * @returns {React.ComponentType|null}
 */
export function useThemeComponent(name: string): React.ComponentType | null;
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
export function ThemeLayout({ layout, fallback, children, ...rest }: ThemeLayoutOwnProps & Record<string, any>): React.ReactNode;
export type ThemeProviderProps = {
    /**
     * - registry from createThemeRegistry
     */
    layouts?: any;
    /**
     * - registry from createThemeRegistry
     */
    components?: any;
    /**
     * - theme to fall back to (default 'default')
     */
    fallback?: string;
    /**
     * - skip the fetch and use this slug
     */
    active?: string;
    /**
     * - where to ask which theme is active
     */
    endpoint?: string;
    children?: import("react").ReactNode;
};
export type ThemeLayoutOwnProps = {
    /**
     * - the layout name to look for
     */
    layout: string;
    /**
     * - shown while the chunk loads
     */
    fallback?: import("react").ReactNode;
    /**
     * - used when no theme provides the layout
     */
    children?: (() => import("react").ReactNode) | import("react").ReactNode;
};
import React from 'react';
