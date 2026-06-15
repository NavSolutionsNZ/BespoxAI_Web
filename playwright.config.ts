import { defineConfig, devices } from '@playwright/test'

/**
 * BespoxAI end-to-end lifecycle tests.
 *
 * Runs against PRODUCTION (or a preview) using credentials supplied via env.
 * Nothing is hardcoded — copy .env.e2e.example to .env.e2e and fill it in.
 *
 * Run:   npx playwright test
 * Headed: npx playwright test --headed
 * Debug:  npx playwright test --debug
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
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
