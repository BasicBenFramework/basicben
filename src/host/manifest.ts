/**
 * The static half of a feature: facts code can read without booting the
 * server. A feature's `manifest.ts` must import nothing at runtime (type
 * imports are fine), because the export and backup scripts load it with plain
 * Node, which resolves no extensionless imports.
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
}
