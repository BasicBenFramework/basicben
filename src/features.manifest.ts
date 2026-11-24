/**
 * The static half of every feature, by name: for code that cannot boot the
 * server (the export and backup scripts), for checking a site's `features`
 * list, and for the admin menu.
 *
 * Keep the keys in step with src/features.ts and src/client/features.ts.
 */
import type { FeatureManifest } from './host/manifest.ts'
import analytics from './features/analytics/manifest.ts'
import members from './features/members/manifest.ts'
import mysendbox from './features/mysendbox/manifest.ts'
import theme from './features/theme/manifest.ts'

const manifests: Record<string, FeatureManifest> = { analytics, members, mysendbox, theme }

export default manifests
