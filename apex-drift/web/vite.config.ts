import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  // A literal true/false, so the minifier removes the owner build's cheats from every other build.
  define: { __OWNER__: JSON.stringify(process.env.VITE_OWNER === '1') },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  test: { environment: 'node' },
})
