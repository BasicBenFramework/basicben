import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
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
    noExternal: true  // Bundle all dependencies
  }
})
