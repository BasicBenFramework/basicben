/**
 * The admin half of each enabled feature. Keep in step with src/features.ts
 * and src/features.manifest.ts.
 */
import type { AdminFeature } from './host/index.ts'
import analytics from '../features/analytics/admin.tsx'
import members from '../features/members/admin.tsx'
import mysendbox from '../features/mysendbox/admin.tsx'
import theme from '../features/theme/admin.tsx'

const features: AdminFeature[] = [analytics, members, mysendbox, theme]

export default features
