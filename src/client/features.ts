/**
 * The admin half of each enabled feature. Keep in step with src/features.ts
 * and src/features.manifest.ts.
 */
import type { AdminFeature } from './host'
import analytics from '../features/analytics/admin'

const features: AdminFeature[] = [analytics]

export default features
