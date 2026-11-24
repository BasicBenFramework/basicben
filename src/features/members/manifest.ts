/**
 * Static facts about the members feature, for code that cannot boot the
 * server: the export and backup scripts, and the admin menu. Imports nothing,
 * so plain Node can load it (see src/helpers/export-data.ts for why).
 */
import type { FeatureManifest } from '../../host/manifest.ts'

const manifest: FeatureManifest = {
  name: 'members',
  pages: [
    {
      path: '/admin/members',
      label: 'Members',
      section: 'Site',
      // Gated: only someone who can manage accounts is shown the way to them.
      // The routes behind it refuse everyone else regardless.
      capability: 'user.manage',
      icon: '✉️',
      iconPath: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 7l9 6 9-6'
    }
  ],
  // Magic-link hashes are credentials for an hour; never in a file.
  neverExported: ['member_tokens']
}

export default manifest
