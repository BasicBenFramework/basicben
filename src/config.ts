/**
 * `@basicbenframework/cms/config`: what a site's basicben.config.js calls.
 *
 *   import { defineSite } from '@basicbenframework/cms/config'
 *   export default defineSite({ features: ['analytics', 'members', 'theme'], cors, mail, storage })
 *
 * Every process loads that file: the server, the CLI, the migrator, the
 * admin build. So the feature list is checked here, once, and a misspelt name
 * stops all of them instead of quietly leaving a feature off.
 *
 * Synchronous, and it must stay so: core's loadConfig takes the default
 * export as it finds it. It imports only the manifests, which are data.
 */
import { fileURLToPath } from 'node:url'
import { enabledFeatureNames } from './host/enabled.ts'

/**
 * The CMS's own migrations, all of them, for every site: a feature list
 * switches behaviour, not the schema. Found beside src/ in the repository and
 * beside lib/ in the package. The server entry imports this module too, so
 * Vercel's tracer follows this URL into the function.
 */
export const CMS_MIGRATIONS = fileURLToPath(new URL('../db/migrations/', import.meta.url))

/** The site's own migrations, from `basicben make:migration`, run after the CMS's. */
export const SITE_MIGRATIONS = 'db/migrations'

export interface SiteConfig {
  /**
   * The CMS features this site runs, by name: analytics, members, mysendbox,
   * theme. Order is the order their routes mount in; theme goes last. []
   * is the bare core. Left out, it is the bare core with a warning.
   */
  features?: string[]
  /** Everything else is the framework's config: cors, mail, storage, db, port… */
  [key: string]: unknown
}

export interface ResolvedSiteConfig extends SiteConfig {
  features: string[]
  migrations: string[]
}

export function defineSite(site: SiteConfig = {}): ResolvedSiteConfig {
  if (site === null || typeof site !== 'object' || Array.isArray(site)) {
    throw new Error('defineSite takes the site\'s config, an object')
  }
  for (const name of Array.isArray(site.features) ? site.features : []) {
    if (typeof name === 'string' && /[/\\.@]/.test(name)) {
      throw new Error(`Feature "${name}" in basicben.config.js looks like a path or a package. Only the CMS's own features can be listed for now (phase 4c will open this up).`)
    }
  }
  if ('migrations' in site) {
    throw new Error(
      '`migrations` is set by defineSite: the CMS\'s, then the site\'s db/migrations. ' +
        'Put the site\'s own migrations in db/migrations (basicben make:migration does) and remove the key.'
    )
  }
  return { ...site, features: enabledFeatureNames(site.features), migrations: [CMS_MIGRATIONS, SITE_MIGRATIONS] }
}
