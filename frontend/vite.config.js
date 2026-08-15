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
    // A real, found gap (Step 18): src/test-setup.js has existed since
    // Step 8b (its own header comment already calls it "global test
    // infrastructure, not a one-off mock local to a single test file"),
    // but setupFiles was never actually pointed at it — every test file
    // that happened to avoid rendering useTheme()/AuthLayout.jsx never
    // noticed. InvoiceAnalytics.jsx (this step) is the first component
    // under test that calls useTheme(), which is what surfaced it.
    setupFiles: ['./src/test-setup.js'],
  },
})