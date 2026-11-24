import type { AdminFeature } from '../../client/host'
import MySendboxSettingsCard from './MySendboxSettingsCard'

const mysendbox: AdminFeature = {
  name: 'mysendbox',
  register(admin) {
    admin.fill('settings.reading', MySendboxSettingsCard)
    admin.dictionaries({ es: () => import('./i18n/es') })
  }
}

export default mysendbox
