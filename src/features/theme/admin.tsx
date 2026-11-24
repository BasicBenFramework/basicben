import type { AdminFeature } from '../../client/host'
import ThemeSettingsCard from './ThemeSettingsCard'

const theme: AdminFeature = {
  name: 'theme',
  register(admin) {
    admin.fill('settings.reading', ThemeSettingsCard)
    admin.dictionaries({ es: () => import('./i18n/es') })
  }
}

export default theme
