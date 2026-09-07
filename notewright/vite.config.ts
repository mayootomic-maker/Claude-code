import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { songLibrary } from './src/dev/song-library.ts'

export default defineConfig({
  base: './',
  plugins: [preact(), songLibrary()],
  build: { target: 'es2022', assetsInlineLimit: 0 },
})
