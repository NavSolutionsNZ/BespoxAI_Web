import { test, expect } from '@playwright/test'
import { env, URLS, login, testTag, waitForEither } from './helpers'

/**
 * PARTNER DELIVERER lifecycle.
 *
 * Logs in as a partner_admin, opens a client tenant, creates a requirement,
 * confirms auto-feasibility + spec entry point (the fix you reported), then
 * advances the deliverer pipeline.
 *
 * ⚠ This creates and advances a REAL requirement on production under the test
 * tenant. ADVANCE controls how far it goes:
 *   ADVANCE=safe (default) — stop before irreversible/payment marks
 *   ADVANCE=full           — walk the whole status chain
 *
 * Required env:
 *   PARTNER_URL        (default https://partners.bespoxai.com)
 *   PARTNER_EMAIL      a partner_admin user (e.g. partner@testpartner.com)
 *   PARTNER_PASSWORD
 *   PARTNER_TENANT_ID  the client tenant id to test against (e.g. Acme)
 *   ADVANCE            safe | full   (default safe)
 */
test.describe('Partner deliverer lifecycle', () => {
  const advance = (process.env.ADVANCE || 'safe').toLowerCase()
  const title = testTag('PARTNER') + ' Add production-date guard to sales lines'

  test('create → auto-feasibility → spec → advance pipeline', async ({ page }) => {
    await login(page, URLS.partner(), env('PARTNER_EMAIL'), env('PARTNER_PASSWORD'))

    // Open the client tenant detail directly
    const tenantId = env('PARTNER_TENANT_ID')
    await page.goto(URLS.partner() + '/partner/tenants/' + tenantId)
    await expect(page.getByText(/Requirements|Customisations|Client/i).first()).toBeVisible({ timeout: 30_000 })

    // + New Requirement
    await page.getByRole('button', { name: /\+\s*New Requirement/i }).click()

    // Title + description (partner form placeholders)
    await page.getByPlaceholder(/Brief title for this requirement/i).fill(title)
    await page
      .getByPlaceholder(/Describe the requirement in detail/i)
      .fill(
        'When an item is added to a sales document, check the production date; if not yet ' +
        'reached, remove the line and warn the user. Ignore purchasing; do not change posting routines.'
      )

    // Area + priority (selects). Pick first real option for each.
    const selects = page.locator('select')
    if (await selects.count() >= 2) {
      await selects.nth(0).selectOption({ index: 1 }).catch(() => {})
      await selects.nth(1).selectOption({ index: 1 }).catch(() => {})
    }

    // Create Requirement
    await page.getByRole('button', { name: /Create Requirement/i }).click()

    // Open the requirement we just created (click its title in the list)
    await page.getByText(title, { exact: false }).first().click()

    // ── Auto-feasibility (the fix) ──────────────────────────────────────────
    const idx = await waitForEither(page, [
      'text=/Development required/i',
      'text=/No development needed/i',
      'text=/Constrained/i',
    ])
    console.log('Partner feasibility verdict bucket:', idx)

    // ── Spec generation entry point (the fix) ───────────────────────────────
    const specBtn = page.getByRole('button', { name: /Generate Full Specification|Scope as development anyway/i })
    await expect(specBtn).toBeVisible({ timeout: 30_000 })
    await specBtn.click()
    await waitForEither(page, ['text=/User Story/i', 'text=/Acceptance Criteria/i'])
    await expect(page.getByText(/User Story/i).first()).toBeVisible()

    // ── Deliverer pipeline advance ──────────────────────────────────────────
    // Move to Review
    const moveReview = page.getByRole('button', { name: /Move to Review/i })
    if (await moveReview.count()) { await moveReview.click(); await page.waitForTimeout(1500) }

    // Issue Quote (opens form → amount → confirm)
    const issueQuote = page.getByRole('button', { name: /^Issue Quote$/i })
    if (await issueQuote.count()) {
      await issueQuote.click()
      const amount = page.getByPlaceholder('0.00')
      if (await amount.count()) await amount.fill('1500')
      // The confirm button inside the form is also "Issue Quote"
      const confirm = page.getByRole('button', { name: /Issue Quote/i }).last()
      await confirm.click()
      await page.waitForTimeout(1500)
    }

    if (advance === 'full') {
      // Continue through the chain. These are partner manual marks.
      for (const label of [/Mark Deposit Paid/i, /Start Development/i, /Mark Work Complete/i, /Mark Balance Paid/i]) {
        const btn = page.getByRole('button', { name: label })
        if (await btn.count()) { await btn.click(); await page.waitForTimeout(1500) }
      }
      // Status should reach a late stage
      await expect(page.getByText(/Complete|fully paid|Balance Due/i).first()).toBeVisible({ timeout: 20_000 })
    } else {
      console.log('ADVANCE=safe — stopped after Issue Quote (no payment/irreversible marks).')
    }
  })
})
