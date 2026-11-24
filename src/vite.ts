/**
 * `@basicbenframework/cms/vite`: the CMS's Vite preset.
 *
 *   import { defineConfig } from 'vite'
 *   import { cms } from '@basicbenframework/cms/vite'
 *   export default defineConfig({ plugins: [cms()] })
 *
 * A preset, not a code generator: React and Tailwind, the build-time
 * constants the admin reads, the dev proxy, and the two rules that keep one
 * copy of core and of the CMS in the server. Anything the site sets in its own
 * vite.config.ts wins over these.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin, PluginOption } from 'vite'
import { enabledFeatureNames } from './host/enabled.ts'

const PACKAGE = '@basicbenframework/cms'

/** The site's basicben.config.js, as the server will load it. */
async function siteConfig(root: string): Promise<Record<string, unknown>> {
  for (const file of ['basicben.config.js', 'basicben.config.mjs']) {
    const path = resolve(root, file)
    if (!existsSync(path)) continue
    try {
      return ((await import(pathToFileURL(path).href)).default as Record<string, unknown>) ?? {}
    } catch (err) {
      throw new Error(`Could not load ${file}: ${(err as Error).message}`, { cause: err })
    }
  }
  return {}
}

function preset(): Plugin {
  return {
    name: 'basicben-cms',
    // What this returns is merged over the site's config, command line
    // included, so anything the site or `basicben build` may set is set here
    // only when they have not.
    async config(user, env) {
      const root = resolve(user.root ?? process.cwd())
      const site = await siteConfig(root)

      return {
        // Deployment flags, baked into the client at build time. Read from
        // plain environment variables rather than VITE_ ones so one variable
        // serves both sides: the server reads process.env, the client reads
        // these. The client half is presentation only; the server enforces.
        define: {
          __DISABLE_REGISTRATION__: JSON.stringify(process.env.DISABLE_REGISTRATION === 'true'),
          __DISABLE_PUBLIC_SITE__: JSON.stringify(process.env.DISABLE_PUBLIC_SITE === 'true'),
          // The site's features, checked. The admin loads only these; the
          // server reads the same list from the same file at boot.
          __BASICBEN_FEATURES__: JSON.stringify(enabledFeatureNames(site.features))
        },
        // Vite handles the package itself (its CSS, its glob of dictionaries,
        // the constants above) instead of pre-bundling it. React is then no
        // longer found through it, so it is named, or the dev server serves
        // React's CommonJS raw ("does not provide an export named 'jsx'").
        optimizeDeps: {
          exclude: [PACKAGE],
          include: ['react', 'react/jsx-runtime', 'react-dom/client']
        },
        server: {
          port: user.server?.port ?? parseInt(process.env.VITE_PORT || '3000'),
          proxy: {
            '/api': { target: `http://localhost:${process.env.PORT || 3001}`, changeOrigin: true }
          }
        },
        // The admin's build. The server's (`vite build --ssr`) names its own
        // entry and output directory.
        build: env.isSsrBuild
          ? {}
          : {
              outDir: user.build?.outDir ?? 'dist/client',
              rollupOptions: { input: user.build?.rollupOptions?.input ?? resolve(root, 'index.html') }
            },
        ssr: {
          // Bundle the site's own server code and its dependencies...
          noExternal: true,
          // ...but never core or the CMS. Both hold singletons (the hook
          // registry, the database connection, the feature host). A bundled
          // copy registers hooks in a registry nothing fires, and the CMS
          // finds its migrations and mail through import.meta.url.
          external: ['@basicbenframework/core', PACKAGE]
        }
      }
    }
  }
}

export function cms(): PluginOption[] {
  return [react(), tailwindcss(), preset()]
}
