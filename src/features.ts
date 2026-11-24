/**
 * Every feature the CMS ships, by name. Each is a folder in src/features/.
 *
 * A site turns them on with `features` in basicben.config.js, and that list
 * sets the order: a feature's routes are mounted after core's and after the
 * features listed before it. An empty list is the bare core.
 *
 * Importing a feature's index.ts does nothing by itself: a feature acts only
 * through the host, when it is registered.
 *
 * Keep the keys in step with src/client/features.ts and src/features.manifest.ts.
 */
import type { Feature } from './host/index.ts'
import analytics from './features/analytics/index.ts'
import members from './features/members/index.ts'
import mysendbox from './features/mysendbox/index.ts'
import theme from './features/theme/index.ts'

const features: Record<string, Feature> = { analytics, members, mysendbox, theme }

export default features
