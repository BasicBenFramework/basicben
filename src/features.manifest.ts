/**
 * The static half of each enabled feature, for code that cannot boot the
 * server (the export and backup scripts) and for the admin menu.
 *
 * Keep in step with src/features.ts and src/client/features.ts: a feature is
 * enabled by a line in each, and removed by deleting those lines and its folder.
 */
import type { FeatureManifest } from './host/manifest.ts'
import analytics from './features/analytics/manifest.ts'

const manifests: FeatureManifest[] = [analytics]

export default manifests
