import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // The shell loads this from disk, not from a server. Relative asset paths are required.
    assetsDir: 'assets',
    sourcemap: true,
    target: 'chrome120',
  },
  base: './',
  server: { port: 5173, strictPort: true },
});
