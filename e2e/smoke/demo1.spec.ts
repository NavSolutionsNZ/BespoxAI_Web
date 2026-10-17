import { test, expect, expectBc } from '../fixtures'
import { URLS, DEMO1_STATE } from '../helpers'

/**
 * @smoke — Demo1 tenant dashboard, signed in, read-only.
 *
 * Each live view must render its heading without errors. Cash Flow and
 * Month-End Close are "soon" placeholders and are skipped.
 *
 * E2E_EXPECT_BC=1 adds a BC round-trip: the agent badge must show connected
 * and one CFO question must come back with an answer. Off by default because
 * the bc22 Docker host isn't always running and the query spends AI tokens.
 */

test.use({ storageState: DEMO1_STATE })

const VIEWS: { view: string; heading: RegExp }[] = [
  { view: 'assistant',      heading: /^CFO Assistant$/ },
  { view: 'health',         heading: /^Data Health Scanner$/ },
  { view: 'customisations', heading: /^Customisations$/ },
  { view: 'migration',      heading: /^Migration Analyser$/ },
]

async function openView(page: import('@playwright/test').Page, view: string) {
  const res = await page.goto(URLS.main() + '/dashboard?view=' + view)
  expect(res?.ok()).toBeTruthy()
  // Bounced to login/onboarding means the saved session or account is wrong.
  await expect(page).toHaveURL(/\/dashboard/)
}

test.describe('@smoke Demo1 dashboard', () => {
  for (const v of VIEWS) {
    test('view: ' + v.view, async ({ page }) => {
      const pending = v.view === 'customisations'
        ? page.waitForResponse(r => new URL(r.url()).pathname === '/api/requirements' && r.request().method() === 'GET')
        : null

      await openView(page, v.view)
      await expect(page.getByRole('heading', { level: 1, name: v.heading })).toBeVisible()

      if (v.view === 'assistant') {
        await expect(page.getByPlaceholder(/Ask about your/i)).toBeVisible()
      }
      if (pending) {
        const r = await pending
        expect(r.status(), 'GET /api/requirements').toBe(200)
      }

      // Let the view's initial fetches settle so the error guard sees them.
      await page.waitForLoadState('networkidle').catch(() => {})
    })
  }

  test('BC round-trip (E2E_EXPECT_BC=1)', async ({ page }) => {
    test.skip(!expectBc, 'Set E2E_EXPECT_BC=1 when the Demo1 BC container is running')

    await openView(page, 'assistant')
    await expect(page.getByText(/ connected$/i)).toBeVisible({ timeout: 30_000 })

    const box = page.getByPlaceholder(/Ask about your/i)
    await box.fill('Top 10 customers by balance')
    await box.press('Enter')

    const answered = page.getByRole('button', { name: /Export PDF/i })
    const failed   = page.getByText(/^Error:/)
    const refused  = page.getByText(/Query not supported/i)
    await expect(answered.or(failed).or(refused).first()).toBeVisible({ timeout: 150_000 })
    expect(await failed.count(), 'CFO Assistant returned an error').toBe(0)
    expect(await refused.count(), 'CFO Assistant refused the query').toBe(0)
  })
})
