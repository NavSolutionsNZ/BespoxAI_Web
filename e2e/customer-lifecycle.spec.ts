import { test, expect } from './fixtures'
import { env, URLS, login, testTag, waitForEither } from './helpers'

/**
 * @lifecycle — CUSTOMER side (partner's customer OR direct customer — same UI).
 *
 * create → auto-feasibility → spec-generation entry point → spec renders.
 *
 * ⚠ Creates a real [E2E-TEST …] requirement and spends AI tokens
 * (feasibility + spec). Clean up with scripts/e2e-cleanup.sql.
 *
 * Required env: CUSTOMER_EMAIL, CUSTOMER_PASSWORD (MAIN_URL optional)
 */
test.describe('@lifecycle Customer requirement lifecycle', () => {
  const title = testTag('CUST') + ' Restrict negative inventory on sales lines'

  test('create → auto-feasibility → spec', async ({ page }) => {
    await login(page, URLS.main(), env('CUSTOMER_EMAIL'), env('CUSTOMER_PASSWORD'))

    await page.goto(URLS.main() + '/dashboard?view=customisations')
    await expect(page.getByRole('heading', { level: 1, name: /^Customisations$/ })).toBeVisible()

    // + New Request
    await page.getByRole('button', { name: /\+\s*New Request/i }).click()
    await page.getByPlaceholder(/Add two-level approval/i).fill(title)
    await page
      .getByPlaceholder(/purchase orders go straight to the vendor/i)
      .fill(
        'When a sales line is entered for an item whose available inventory would go ' +
        'negative, block the line and warn the user. Do not change posting routines.'
      )

    // Save & Check Feasibility → (feasibility starts automatically after create)
    const created = page.waitForResponse(r =>
      new URL(r.url()).pathname === '/api/requirements' && r.request().method() === 'POST')
    await page.getByRole('button', { name: /Save & Check Feasibility/i }).click()
    const createdRes = await created
    expect(createdRes.status(), 'POST /api/requirements').toBeLessThan(300)
    const reqId = (await createdRes.json()).requirement?.id
    console.log('Created requirement', reqId, title)

    // Verdict — labels from components/RequirementsBuilder.tsx
    const verdict = await waitForEither(page, [
      'text=/Development required/i',          // 0: development → "Generate Full Specification →"
      'text=/may not need development/i',      // 1: cfo_assistant → "Scope as development anyway"
      'text=/Technical constraints identified/i', // 2: infeasible → no spec path
    ])
    console.log('Feasibility verdict:', ['development', 'cfo_assistant', 'infeasible'][verdict])

    if (verdict === 2) {
      // Valid outcome, but there's no spec path to test. Don't fail on AI judgement.
      test.info().annotations.push({ type: 'note', description: 'Verdict was infeasible — spec step not exercised' })
      return
    }

    const specBtn = verdict === 0
      ? page.getByRole('button', { name: /Generate Full Specification/i })
      : page.getByRole('button', { name: /Scope as development anyway/i })
    await expect(specBtn).toBeVisible()
    await specBtn.click()

    await waitForEither(page, ['text=/User Story/i', 'text=/Acceptance Criteria/i'])
    await expect(page.getByText(/User Story/i).first()).toBeVisible()
    await expect(page.getByText(/Acceptance Criteria/i).first()).toBeVisible()
  })
})
