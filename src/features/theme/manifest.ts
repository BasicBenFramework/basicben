/**
 * Static facts about the theme feature. It has no admin page of its own (its
 * one setting sits on the Settings page) and no tables.
 */
import type { FeatureManifest } from '../../host/manifest.ts'

const manifest: FeatureManifest = {
  name: 'theme',
  // /:slug and /:base/:slug would catch any route mounted after them.
  mountLast: true
}

export default manifest
