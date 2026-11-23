import type { AdminFeature } from '../../client/host'
import AnalyticsPage from './AnalyticsPage'

const analytics: AdminFeature = {
  name: 'analytics',
  register(admin) {
    admin.page('/admin/analytics', AnalyticsPage)
    admin.dictionaries({ es: () => import('./i18n/es') })
  }
}

export default analytics
