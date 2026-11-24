/**
 * Static facts about the mysendbox feature, for code that cannot boot the
 * server. Imports nothing, so plain Node can load it.
 */
import type { FeatureManifest } from '../../host/manifest.ts'

const manifest: FeatureManifest = {
  name: 'mysendbox',
  // Sync state, meaningful only next to this database's MySendbox workspace.
  neverExported: ['mysendbox_contacts', 'mysendbox_broadcasts']
}

export default manifest
