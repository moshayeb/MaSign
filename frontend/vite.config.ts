/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Built files land in dist/ and are served by the FastAPI app (app/main.py);
// `npm run dev` proxies /api to a locally running API instead.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
    // MAS-208: on the dev PC four files exceed the 5 s default on every full
    // run (slow machine, not a hang); 20 s still catches a genuinely stuck test.
    testTimeout: 20000,
  },
})
