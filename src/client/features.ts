/**
 * The admin half of every feature, loaded only when the site enables it, so
 * a feature the site leaves off is not in the admin bundle's startup path.
 * Keep the keys in step with src/features.ts and src/features.manifest.ts.
 */
import type { AdminFeature } from './host/index.ts'

type Loader = () => Promise<{ default: AdminFeature }>

const features: Record<string, Loader> = {
  analytics: () => import('../features/analytics/admin.tsx'),
  members: () => import('../features/members/admin.tsx'),
  mysendbox: () => import('../features/mysendbox/admin.tsx'),
  theme: () => import('../features/theme/admin.tsx')
}

export default features
