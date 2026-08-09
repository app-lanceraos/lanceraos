import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  // No test files existed before Step 8b (jsdom/@testing-library/react were
  // devDependencies already, but nothing had wired vitest's `test` config
  // in yet) — added minimally here so `npm test` actually runs against a
  // browser-like environment rather than vitest's bare-node default.
  test: {
    environment: 'jsdom',
    globals: true,
  },
})