import { configDefaults, defineConfig } from 'vitest/config'
// Fault tests start their own databases and take minutes: run them with `npm run test:fault`.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, 'fault/**', 'bench/**'] } })
