import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: { 'import.meta.vitest': 'undefined' },
  build: { target: 'es2022', assetsInlineLimit: 100 * 1024 * 1024 },
  test: { includeSource: ['src/**/*.{ts,tsx}'] },
})
