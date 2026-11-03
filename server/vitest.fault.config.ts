import { defineConfig } from 'vitest/config'
// Fault tests start real databases and processes, so they are slow and run one at a time.
export default defineConfig({
  test: { include: ['fault/**/*.test.ts'], testTimeout: 180_000, hookTimeout: 120_000, fileParallelism: false, sequence: { concurrent: false } },
})
