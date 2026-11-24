import type { AdminFeature } from '../../client/host/index.ts'
import MySendboxSettingsCard from './MySendboxSettingsCard.tsx'

const mysendbox: AdminFeature = {
  name: 'mysendbox',
  register(admin) {
    admin.fill('settings.reading', MySendboxSettingsCard)
    admin.dictionaries({ es: () => import('./i18n/es.ts') })
  }
}

export default mysendbox
