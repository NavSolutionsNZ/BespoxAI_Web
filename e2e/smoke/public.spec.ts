import { test, expect } from '../fixtures'
import { URLS } from '../helpers'

/**
 * @smoke — public pages, no sign-in, read-only.
 * Each page must load (2xx), show its heading, and raise no errors.
 */

test.describe('@smoke public pages', () => {
  test('marketing homepage', async ({ page }) => {
    const res = await page.goto(URLS.main() + '/')
    expect(res?.ok()).toBeTruthy()
    await expect(page).toHaveURL(/\/index\.html$/)
    await expect(page.locator('body')).toContainText(/BespoxAI/i)
  })

  test('login', async ({ page }) => {
    const res = await page.goto(URLS.main() + '/login')
    expect(res?.ok()).toBeTruthy()
    await expect(page.getByRole('heading', { name: /Sign in to your portal/i })).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /Sign in to portal/i })).toBeVisible()
  })

  test('signup', async ({ page }) => {
    const res = await page.goto(URLS.main() + '/signup')
    expect(res?.ok()).toBeTruthy()
    await expect(page.getByRole('heading', { name: /Start your free trial/i })).toBeVisible()
  })

  test('demo', async ({ page }) => {
    const res = await page.goto(URLS.main() + '/demo')
    expect(res?.ok()).toBeTruthy()
    // Render check only — no query is sent (it would spend AI tokens).
    await expect(page.getByPlaceholder(/Ask about revenue/i)).toBeVisible()
  })

  test('partner site home', async ({ page }) => {
    const res = await page.goto(URLS.partner() + '/')
    expect(res?.ok()).toBeTruthy()
    await expect(page.getByRole('heading', { name: /Grow your NAV and BC practice/i })).toBeVisible()
  })

  test('partner site signup', async ({ page }) => {
    const res = await page.goto(URLS.partner() + '/signup')
    expect(res?.ok()).toBeTruthy()
    await expect(page.getByRole('heading', { name: /Apply to become a partner/i })).toBeVisible()
  })

  test('partner login', async ({ page }) => {
    const res = await page.goto(URLS.partner() + '/login')
    expect(res?.ok()).toBeTruthy()
    await expect(page.getByRole('heading', { name: /Sign in to your partner portal/i })).toBeVisible()
  })
})
