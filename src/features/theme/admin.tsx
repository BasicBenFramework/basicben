import type { AdminFeature } from '../../client/host/index.ts'
import ThemeSettingsCard from './ThemeSettingsCard.tsx'

const theme: AdminFeature = {
  name: 'theme',
  register(admin) {
    admin.fill('settings.reading', ThemeSettingsCard)
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

export default theme
