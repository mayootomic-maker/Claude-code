import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import tailwind from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    preact(),
    tailwind(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        name: 'Pendlo Solo',
        short_name: 'Pendlo',
        description: 'Dein persönlicher ÖV-Pendler-Begleiter',
        lang: 'de-CH',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Never serve stale transport data from the SW cache: the app layer owns
        // freshness and labels staleness itself. See lib/staleness.ts.
        navigateFallback: '/index.html',
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    reportCompressedSize: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
