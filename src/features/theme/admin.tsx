import type { AdminFeature } from '../../client/host/index.ts'
import ThemeSettingsCard from './ThemeSettingsCard.tsx'

const theme: AdminFeature = {
  name: 'theme',
  register(admin) {
    admin.fill('settings.reading', ThemeSettingsCard)
    admin.dictionaries({ es: () => import('./i18n/es.ts') })
  }
}

export default theme
