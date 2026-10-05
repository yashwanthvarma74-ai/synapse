import path from 'node:path'
import { defineConfig } from 'vitest/config'

// "@/..." imports point at src/, the same as in the app. Component tests opt in to a
// browser-like DOM with a "@vitest-environment jsdom" comment at the top of the file.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
