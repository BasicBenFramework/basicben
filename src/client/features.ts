/**
 * The admin half of each enabled feature. Keep in step with src/features.ts
 * and src/features.manifest.ts.
 */
import type { AdminFeature } from './host'
import analytics from '../features/analytics/admin'
import members from '../features/members/admin'
import mysendbox from '../features/mysendbox/admin'
import theme from '../features/theme/admin'

const features: AdminFeature[] = [analytics, members, mysendbox, theme]

export default features
