import { defineConfig } from 'vite'
import { cms } from '@basicbenframework/cms/vite'

// The CMS's preset: React, Tailwind, the admin's build-time constants, the dev
// proxy to the API, and the server build rules. Settings added here win.
export default defineConfig({
  plugins: [cms()]
})
