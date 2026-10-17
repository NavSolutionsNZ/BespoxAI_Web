import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { env, URLS, login, testTag, waitForEither } from './helpers'

/**
 * @lifecycle — PARTNER DELIVERER side (app/partner/tenants/[id]/page.tsx).
 *
 * create (draft) → auto-feasibility → spec → Submit for Review → Move to Review
 * → Issue Quote / Send Quote → [ADVANCE=full] Accept Quote (on client's behalf)
 * → Mark Deposit Paid → Start Development → Mark Work Complete → Mark Balance Paid
 *
 * ⚠ Creates and advances a real [E2E-TEST …] requirement on the client tenant,
 * spends AI tokens, and Send Quote emails the client user. Clean up with
 * scripts/e2e-cleanup.sql.
 *   ADVANCE=safe (default) — stop once the quote is sent (status: quoted)
 *   ADVANCE=full           — walk to fully_paid
 *
 * Required env: PARTNER_EMAIL, PARTNER_PASSWORD, PARTNER_TENANT_ID (PARTNER_URL optional)
 */

// Click a pipeline button, then wait for proof the status really moved on.
// (Status *text* can't be used: the pipeline stepper always shows every label.)
async function advance(page: Page, button: RegExp, proof: () => Promise<void>) {
  const btn = page.getByRole('button', { name: button })
  await expect(btn, 'button ' + button).toBeVisible()
  await btn.click()
  await proof()
}
const visible = (page: Page, name: RegExp) => () =>
  expect(page.getByRole('button', { name }), 'next action ' + name).toBeVisible({ timeout: 30_000 })
const gone = (page: Page, name: RegExp) => () =>
  expect(page.getByRole('button', { name }), 'action consumed ' + name).toHaveCount(0, { timeout: 30_000 })

test.describe('@lifecycle Partner deliverer lifecycle', () => {
  const mode = (process.env.ADVANCE || 'safe').toLowerCase()
  const title = testTag('PARTNER') + ' Add production-date guard to sales lines'

  test('create → feasibility → spec → submit → quote' + (mode === 'full' ? ' → paid' : ''), async ({ page }) => {
    await login(page, URLS.partner(), env('PARTNER_EMAIL'), env('PARTNER_PASSWORD'))

    // Client tenant, Requirements tab (the page defaults to ?tab=overview)
    const tenantId = env('PARTNER_TENANT_ID')
    await page.goto(URLS.partner() + '/partner/tenants/' + tenantId + '?tab=requirements')
    const newBtn = page.getByRole('button', { name: /\+\s*New Requirement/i })
    await expect(newBtn).toBeVisible()
    await newBtn.click()

    await page.getByPlaceholder(/Brief title for this requirement/i).first().fill(title)
    await page
      .getByPlaceholder(/Describe the requirement in detail/i).first()
      .fill(
        'When an item is added to a sales document, check the production date; if not yet ' +
        'reached, remove the line and warn the user. Ignore purchasing; do not change posting routines.'
      )
    // Area + priority: both start on an empty "Select …" option
    const selects = page.locator('select:has(option:text-is("Select area")), select:has(option:text-is("Select priority"))')
    await expect(selects).toHaveCount(2)
    await selects.nth(0).selectOption({ index: 1 })
    await selects.nth(1).selectOption({ index: 1 })

    // Create Requirement — the new requirement opens automatically (?req=<id>)
    await page.getByRole('button', { name: /^Create Requirement$/ }).click()
    await page.waitForURL(url => url.searchParams.has('req'), { timeout: 30_000 })
    console.log('Created requirement', new URL(page.url()).searchParams.get('req'), title)

    // ── Auto-feasibility (fires when a pre-quote requirement has no verdict) ──
    const verdict = await waitForEither(page, [
      'text=/Development required/i',  // 0 → "Generate Full Specification →"
      'text=/No development needed/i', // 1 → "Scope as development anyway"
      'text=/Constrained/i',           // 2 → no spec path
    ])
    console.log('Feasibility verdict:', ['development', 'cfo_assistant', 'infeasible'][verdict])
    if (verdict === 2) {
      test.info().annotations.push({ type: 'note', description: 'Verdict was infeasible — pipeline not exercised' })
      return
    }

    // ── Spec ────────────────────────────────────────────────────────────────
    const specBtn = page.getByRole('button', { name: /Generate Full Specification|Scope as development anyway/i })
    await expect(specBtn).toBeVisible()
    await specBtn.click()
    await waitForEither(page, ['text=/User Story/i', 'text=/Acceptance Criteria/i'])
    await expect(page.getByText(/User Story/i).first()).toBeVisible()

    // ── Deliverer pipeline ──────────────────────────────────────────────────
    await advance(page, /^Submit for Review$/, visible(page, /^Move to Review$/))
    await advance(page, /^Move to Review$/, gone(page, /^Move to Review$/))

    await page.getByRole('button', { name: /^Issue Quote$/ }).click()
    await page.getByPlaceholder('0.00').fill('1500')
    await advance(page, /^Send Quote$/, visible(page, /^Accept Quote$/))   // status: quoted

    if (mode !== 'full') {
      console.log('ADVANCE=safe — stopped at Quoted (no acceptance or payment marks).')
      return
    }

    await advance(page, /^Accept Quote$/,       visible(page, /^Mark Deposit Paid$/))
    await advance(page, /^Mark Deposit Paid$/,  visible(page, /^Start Development$/))
    await advance(page, /^Start Development$/,  visible(page, /^Mark Work Complete$/))
    await advance(page, /^Mark Work Complete$/, visible(page, /^Mark Balance Paid$/))
    await advance(page, /^Mark Balance Paid$/,  async () => {
      await expect(page.getByText('Complete ✓').first(), 'status pill fully_paid').toBeVisible({ timeout: 30_000 })
    })
  })
})
