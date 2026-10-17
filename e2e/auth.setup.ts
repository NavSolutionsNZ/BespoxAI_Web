import { test as setup, expect } from '@playwright/test'
import { env, URLS, login, DEMO1_STATE } from './helpers'

/**
 * Logs in once as the Demo1 tenant user and saves the session cookies.
 * Smoke specs that need a signed-in user load this file via storageState
 * instead of going through /login every time.
 *
 * Required env: DEMO_EMAIL, DEMO_PASSWORD
 */
setup('sign in as Demo1', async ({ page }) => {
  await login(page, URLS.main(), env('DEMO_EMAIL'), env('DEMO_PASSWORD'))
  await page.waitForURL(url => url.pathname.startsWith('/dashboard'), { timeout: 45_000 })
  await expect(page.locator('h1').first()).toBeVisible()
  await page.context().storageState({ path: DEMO1_STATE })
})
