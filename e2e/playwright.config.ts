// End-to-end tests in three real browser engines (Chromium, Firefox, WebKit). They start their
// OWN copy of the app on separate ports with a separate database (synapse_e2e), so running them
// never touches your normal data or a dev server that is already open.
//
//   cd e2e && npm test                 # all three browsers
//   cd e2e && npm run test:chromium    # just one, faster
//   E2E_S3=1 npm test                  # also run the upload test (needs MinIO on :9000, see docs/DEPLOY.md)
//
// Needs MongoDB running locally on :27017. Redis is not needed (one gateway).
import { defineConfig, devices } from '@playwright/test'

const WEB = 3100, GATEWAY = 4100, API = 4101
export const URLS = { web: `http://127.0.0.1:${WEB}`, api: `http://127.0.0.1:${API}` }

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: URLS.web, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: '../server',
      url: `${URLS.api}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        GATEWAY_PORT: String(GATEWAY), API_PORT: String(API), METRICS_PORT: '0',
        MONGO_URL: 'mongodb://127.0.0.1:27017', MONGO_DB: 'synapse_e2e',
        WEB_ORIGIN: `${URLS.web},http://localhost:${WEB}`,
        AUTH_RATE_LIMIT: '100000', MAX_GUESTS_PER_HOUR: '100000', INVITE_RATE_LIMIT: '100000',
        LOG_LEVEL: 'warn', JWT_SECRET: 'e2e-only-secret-e2e-only-secret-0123456789',
        ...(process.env.E2E_S3 ? {
          S3_ENDPOINT: 'http://127.0.0.1:9000', S3_REGION: 'us-east-1', S3_BUCKET: 'synapse-e2e',
          S3_ACCESS_KEY_ID: 'synapsedev', S3_SECRET_ACCESS_KEY: 'synapsedev-local-only', S3_CREATE_BUCKET: 'true',
        } : {}),
      },
    },
    {
      // a production build, because that is what people will actually run
      command: 'npm run build && npx next start -p 3100',
      cwd: '../web',
      url: URLS.web,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: {
        NEXT_DIST_DIR: '.next-e2e', NEXT_PUBLIC_API_URL: URLS.api, NEXT_PUBLIC_GATEWAY_URL: `ws://127.0.0.1:${GATEWAY}`,
        NEXT_PUBLIC_TELEMETRY: 'off',
      },
    },
  ],
})
