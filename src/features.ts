/**
 * The features this site runs, in order. Each is a folder in src/features/.
 *
 * An empty list is the bare core. Order matters only for routes: a feature's
 * routes are mounted after core's and after the features before it.
 *
 * Keep in step with src/client/features.ts and src/features.manifest.ts.
 */
import type { Feature } from './host'
import analytics from './features/analytics/index.ts'
import members from './features/members/index.ts'
import theme from './features/theme/index.ts'

const features: Feature[] = [analytics, members, theme]

export default features
