/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // jsdom, not the default node environment: the thing worth testing here is a
    // component's behaviour against `location` and `history`, which don't exist
    // outside a DOM. A test that can't touch the URL can't catch the bug that
    // broke sign-in.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
