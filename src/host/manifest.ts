/**
 * The static half of a feature: facts code can read without booting the
 * server. A feature's `manifest.ts` must import nothing at runtime (type
 * imports are fine): the export and backup scripts and the site config read
 * it with plain Node, and reading a feature's facts must not load the feature.
 */

export interface FeaturePage {
  path: string
  /** English; translated in the admin like core's menu labels. */
  label: string
  section?: string
  capability?: string
  /** Emoji fallback, as core menu items carry. */
  icon?: string
  /** SVG path data for the sidebar icon, drawn like core's icons. */
  iconPath?: string
}

export interface FeatureManifest {
  name: string
  /** Admin pages, which become menu entries on the server and routes in the browser. */
  pages?: FeaturePage[]
  /** Tables the full-content export includes, in dependency order. */
  exportTables?: Array<{ name: string; omit?: string[] }>
  /** Tables listed in the export's report as deliberately left out. */
  neverExported?: string[]
  /**
   * Its routes catch what is mounted after them (the theme's /:slug), so it
   * must be listed after every feature that is not mountLast too.
   */
  mountLast?: boolean
}
