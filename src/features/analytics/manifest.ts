/**
 * Static facts about the analytics feature, for code that cannot boot the
 * server: the export and backup scripts, and the admin menu. Imports nothing,
 * so plain Node can load it (see src/helpers/export-data.ts for why).
 */
import type { FeatureManifest } from '../../host/manifest.ts'

const manifest: FeatureManifest = {
  name: 'analytics',
  pages: [
    {
      path: '/admin/analytics',
      label: 'Analytics',
      section: 'Site',
      capability: 'post.edit',
      icon: '📈',
      iconPath: 'M4 20V10M10 20V4M16 20v-7M22 20H2'
    }
  ],
  // The visitor hashes and the day's salt exist only so they can be deleted
  // within a day; copying them into a file would defeat that. The counts are
  // simply not exported (no natural key for an importer to merge on).
  neverExported: ['analytics_salts', 'analytics_seen']
}

export default manifest
