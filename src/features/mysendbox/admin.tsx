import type { AdminFeature } from '../../client/host/index.ts'
import MySendboxSettingsCard from './MySendboxSettingsCard.tsx'

const mysendbox: AdminFeature = {
  name: 'mysendbox',
  register(admin) {
    admin.fill('settings.reading', MySendboxSettingsCard)
    admin.dictionaries({
      de: () => import('./i18n/de.ts'),
      es: () => import('./i18n/es.ts'),
      fr: () => import('./i18n/fr.ts'),
      pt: () => import('./i18n/pt.ts'),
      ja: () => import('./i18n/ja.ts'),
      zh: () => import('./i18n/zh.ts')
    })
  }
}

export default mysendbox
