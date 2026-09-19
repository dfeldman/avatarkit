import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// base './' so the build works from any folder (on Dandyhorse it could live under /avatar/).
export default defineConfig({
  base: './',
  server: { port: 5194, strictPort: true },
  preview: { port: 5195, strictPort: true },
  worker: { format: 'es' },
  build: {
    // Babylon comes in through the @babylonjs/core barrel (~7 MB, 1.5 MB gzipped), like the games
    chunkSizeWarningLimit: 7500,
    rollupOptions: {
      input: {
        designer: resolve(import.meta.dirname, 'index.html'),
        gallery: resolve(import.meta.dirname, 'gallery.html'),
        dev: resolve(import.meta.dirname, 'dev.html'),
        embed: resolve(import.meta.dirname, 'embed.html'),
      },
    },
  },
})
