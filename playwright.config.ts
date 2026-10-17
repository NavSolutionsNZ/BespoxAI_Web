import { defineConfig, devices } from '@playwright/test'

/**
 * BespoxAI end-to-end tests.
 *
 * Runs against PRODUCTION (or a preview) using credentials supplied via env.
 * Nothing is hardcoded — copy e2e/.env.e2e.example to .env.e2e and fill it in.
 *
 * Tiers (see e2e/README.md):
 *   npm run e2e:smoke      read-only, fast — safe after every deploy
 *   npm run e2e:lifecycle  creates real [E2E-TEST …] requirements, slow (AI)
 *   npm run e2e:report     open the last HTML report
 */
export default defineConfig({
  testDir: './e2e',
  // Lifecycle steps depend on order within a file, so no parallel inside a file.
  fullyParallel: false,
  workers: 1,
  // AI feasibility/spec generation can take a while — be patient.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Base URLs come from env; default to production.
    baseURL: process.env.MAIN_URL || 'https://bespoxai.com',
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    // Signs in once as Demo1 and saves the session for smoke-demo1.
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    // Public pages — no sign-in, so they still run if the setup fails.
    { name: 'smoke-public', testMatch: /smoke\/public\.spec\.ts$/ },
    { name: 'smoke-demo1', testMatch: /smoke\/demo1\.spec\.ts$/, dependencies: ['setup'] },
    // Writes real data — only run on purpose.
    { name: 'lifecycle', testMatch: /-lifecycle\.spec\.ts$/ },
  ],
})
