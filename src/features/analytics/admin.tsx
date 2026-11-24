import type { AdminFeature } from '../../client/host/index.ts'
import AnalyticsPage from './AnalyticsPage.tsx'

const analytics: AdminFeature = {
  name: 'analytics',
  register(admin) {
    admin.page('/admin/analytics', AnalyticsPage)
    admin.dictionaries({ es: () => import('./i18n/es.ts') })
  }
}

export default analytics
