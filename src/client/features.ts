/**
 * The admin half of each enabled feature. Keep in step with src/features.ts
 * and src/features.manifest.ts.
 */
import type { AdminFeature } from './host'
import analytics from '../features/analytics/admin'
import members from '../features/members/admin'

const features: AdminFeature[] = [analytics, members]

export default features
