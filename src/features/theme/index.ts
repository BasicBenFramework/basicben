/**
 * The reference public site: a server-rendered theme, and the oEmbed provider.
 *
 * Remove this folder and its lines in src/features.ts, src/client/features.ts
 * and src/features.manifest.ts, and the core runs headless: the content API,
 * feeds and sitemap are core and carry on. Listed last, because its `/:slug`
 * and `/:base/:slug` routes would catch any route mounted after them.
 */

import { checks } from '../../helpers/site-settings.ts'
import type { Feature } from '../../host/index.ts'
import { themeRoutes } from './routes.ts'

const theme: Feature = {
  name: 'theme',

  register(host) {
    host.settings.define({
      // Whether this app renders the public site itself (`ssr`) or leaves it
      // to the SPA / a headless front end (blank). The PUBLIC_THEME
      // environment variable, when set, wins: `ssr` or `off`.
      public_theme: { group: 'reading', check: checks.oneOf(['', 'ssr']) }
    })

    host.routes(themeRoutes)
  }
}

export default theme
