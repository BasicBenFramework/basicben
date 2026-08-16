/**
 * Theme discovery — the part with no React in it.
 *
 * Split out from `theme.js` deliberately. The framework has no runtime
 * dependencies, and its test suite runs with nothing installed at all — CI runs
 * `npm test` before `npm ci`, which is a real check on that claim rather than a
 * stated one. React is a *peer* dependency, provided by the app, so a framework
 * test that needs it installed quietly gives that property up.
 *
 * Indexing a glob is pure string work, so it lives here and is tested here.
 * `theme.js` re-exports it alongside the components that do need React.
 */

/**
 * Index the modules produced by `import.meta.glob`.
 *
 * @param {Object} modules - path → () => Promise<Module>, from import.meta.glob
 * @returns {Object} registry keyed by theme slug, then component name
 *
 * @example
 * const layouts = createThemeRegistry(
 *   import.meta.glob('../../themes/[*]/layouts/[*].tsx')
 * )
 */
export function createThemeRegistry(modules = {}) {
  const registry = {}

  for (const [path, loader] of Object.entries(modules)) {
    const parsed = parseThemePath(path)
    if (!parsed) continue

    registry[parsed.theme] ??= {}
    registry[parsed.theme][parsed.name] = loader
  }

  return registry
}

/**
 * Pull the theme slug and component name out of a glob path.
 *
 * Matches `.../themes/<slug>/<layouts|components>/<Name>.<ext>`, which is the
 * shape every theme has to follow for discovery to work at all.
 *
 * @param {string} path
 * @returns {{theme: string, name: string}|null}
 */
export function parseThemePath(path) {
  const match = /themes\/([^/]+)\/(?:layouts|components)\/([^/]+)\.(?:jsx?|tsx?)$/.exec(path)
  if (!match) return null

  return { theme: match[1], name: match[2] }
}

/**
 * Resolve a component name against the active theme, then the fallback.
 *
 * Returns the slug that provides it, or null when neither does — a missing
 * layout is a gap in a theme, not an error, and the caller renders its own.
 *
 * @param {Object} registry
 * @param {string} active
 * @param {string} fallback
 * @param {string} name
 * @returns {string|null}
 */
export function resolveThemeSource(registry, active, fallback, name) {
  if (registry?.[active]?.[name]) return active
  if (registry?.[fallback]?.[name]) return fallback

  return null
}
