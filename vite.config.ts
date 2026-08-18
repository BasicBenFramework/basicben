import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Deployment flags, baked into the client at build time.
  //
  // They are read here from plain environment variables rather than VITE_
  // prefixed ones so that a single variable serves both sides: the server
  // reads process.env directly, the client reads these constants. Two names
  // for one switch is how you end up with a site that hides registration in
  // the UI and still accepts it over the API.
  //
  // The client half is presentation only. Disabling registration is enforced
  // in AuthController, because a route the UI does not link to is still a
  // route.
  define: {
    __DISABLE_REGISTRATION__: JSON.stringify(process.env.DISABLE_REGISTRATION === 'true'),
    __DISABLE_PUBLIC_SITE__: JSON.stringify(process.env.DISABLE_PUBLIC_SITE === 'true')
  },
  server: {
    port: parseInt(process.env.VITE_PORT || '3000'),
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT || 3001}`,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist/client',
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.html')
    }
  },
  // Server config used by build:server script
  ssr: {
    // Bundle app dependencies into the server build...
    noExternal: true,

    // ...but never the framework itself.
    //
    // The framework holds singletons — the hook registry, the plugin and theme
    // managers, the database connection. Bundling it produces a second copy of
    // all of them: the bundled server registers a plugin's hooks in its own
    // registry, while a controller loaded from disk at runtime imports the
    // framework from node_modules and fires on a different one. Nothing errors;
    // the hooks simply never run, and getDb() opens a second connection.
    external: ['@basicbenframework/core']
  }
})
