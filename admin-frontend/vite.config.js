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
    // Runs alongside the main app's :5173 locally — a distinct port,
    // not the real admin.lanceraos.com subdomain, which is purely a
    // production deployment concern (see DECISIONS.md).
    port: 5174,
  },
})