import React from 'react'
import ReactDOM from 'react-dom/client'
import './client/styles.css'
import { registerAdminFeatures } from './client/host/index.ts'
import adminFeatures from './client/features.ts'
import manifests from './features.manifest.ts'
import { manifestsFor } from './host/enabled.ts'

/**
 * Register the site's features, then build the app.
 *
 * __BASICBEN_FEATURES__ is the site's `features` list, checked and baked in
 * at build time (vite.config). Only those features' admin halves are loaded,
 * and they register before App.tsx is imported, because the route table and
 * the menu are built from what is registered when App.tsx loads.
 */
async function boot() {
  const names: string[] = __BASICBEN_FEATURES__
  const loaded = await Promise.all(names.filter((name) => adminFeatures[name]).map((name) => adminFeatures[name]()))
  registerAdminFeatures(loaded.map((module) => module.default), manifestsFor(names, manifests))

  const { default: App } = await import('./routes/App.tsx')
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

boot()
