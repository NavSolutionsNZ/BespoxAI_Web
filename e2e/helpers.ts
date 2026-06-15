import { Page, expect } from '@playwright/test'

// ── Env helpers ──────────────────────────────────────────────────────────────
export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`Missing required env var: ${name}. See .env.e2e.example`)
  return v
}

export const URLS = {
  main: () => process.env.MAIN_URL || 'https://bespoxai.com',
  partner: () => process.env.PARTNER_URL || 'https://partners.bespoxai.com',
}

// A unique, easy-to-spot tag so test data can be found + cleaned up later.
export function testTag(label: string): string {
  const stamp = new Date().toISOString().slice(5, 16).replace(/[:T]/g, '')
  return `[E2E-TEST ${label} ${stamp}]`
}

// ── Login ────────────────────────────────────────────────────────────────────
// Works for both portals — the login page is shared; the portal it lands on is
// determined by the account type. Pass the base URL of the portal to start on.
export async function login(page: Page, baseUrl: string, email: string, password: string) {
  await page.goto(baseUrl + '/login')

  // Email + password fields (type-based, resilient to class churn)
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)

  // Submit — button text is "Sign in to portal →" (or "Signing in…")
  await page.getByRole('button', { name: /sign in to portal/i }).click()

  // Wait until we've left the login page (either portal, or onboarding/password change)
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 45_000 })

  // If forced to a password-change screen, the test account isn't set up for E2E.
  if (page.url().includes('onboarding') || (await page.getByText(/change.*password/i).count()) > 0) {
    throw new Error(
      'Account landed on onboarding/password-change. Use an account that has already completed first-login setup.'
    )
  }
}

// Poll a condition with a friendly timeout — used for AI steps that take time.
export async function waitForEither(
  page: Page,
  selectors: string[],
  timeout = 150_000
): Promise<number> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    for (let i = 0; i < selectors.length; i++) {
      if ((await page.locator(selectors[i]).count()) > 0) return i
    }
    await page.waitForTimeout(2000)
  }
  throw new Error(`None of the expected elements appeared within ${timeout}ms: ${selectors.join(' | ')}`)
}
