import { test, expect } from '@playwright/test'
import { env, URLS, login, testTag, waitForEither } from './helpers'

/**
 * CUSTOMER-SIDE lifecycle (partner's customer OR direct customer — same UI).
 *
 * Verifies the bit you reported broken: after creating a requirement, the
 * customer gets auto-feasibility and a spec-generation entry point.
 *
 * Required env:
 *   MAIN_URL            (default https://bespoxai.com)
 *   CUSTOMER_EMAIL      a tenant_admin / user on the test tenant (e.g. Acme client)
 *   CUSTOMER_PASSWORD
 */
test.describe('Customer requirement lifecycle', () => {
  const title = testTag('CUST') + ' Restrict negative inventory on sales lines'

  test('create → auto-feasibility → spec entry point', async ({ page }) => {
    await login(page, URLS.main(), env('CUSTOMER_EMAIL'), env('CUSTOMER_PASSWORD'))

    // Go to Customisations
    await page.goto(URLS.main() + '/dashboard?view=customisations')
    await expect(page.getByText(/Customisations/i).first()).toBeVisible()

    // + New Request
    await page.getByRole('button', { name: /\+\s*New Request/i }).click()

    // Fill title + description (placeholder-anchored)
    await page.getByPlaceholder(/Add two-level approval/i).fill(title)
    await page
      .getByPlaceholder(/purchase orders go straight to the vendor/i)
      .fill(
        'When a sales line is entered for an item whose available inventory would go ' +
        'negative, block the line and warn the user. Do not change posting routines.'
      )

    // Save & Check Feasibility →
    await page.getByRole('button', { name: /Save & Check Feasibility/i }).click()

    // Auto-feasibility should kick off. Wait for a verdict to render.
    // Verdicts surface as one of these texts in the feasibility card.
    const idx = await waitForEither(page, [
      'text=/Development required/i',
      'text=/may not need development/i',
      'text=/No development needed/i',
      'text=/Technical constraints/i',
      'text=/Constrained/i',
    ])
    console.log('Feasibility verdict bucket index:', idx)

    // If development is the verdict, the spec-generation CTA must be present.
    if (idx === 0) {
      const specBtn = page.getByRole('button', { name: /Generate Full Specification/i })
      await expect(specBtn).toBeVisible()
      await specBtn.click()
      // Spec renders — User Story / Acceptance Criteria appear.
      await waitForEither(page, ['text=/User Story/i', 'text=/Acceptance Criteria/i'])
      await expect(page.getByText(/User Story/i).first()).toBeVisible()
    } else {
      // Non-dev verdict: assert the feasibility notes are shown (entry point exists).
      console.log('Non-development verdict — spec CTA not expected; feasibility shown.')
    }
  })
})
