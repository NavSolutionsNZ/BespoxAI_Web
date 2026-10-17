import { Page, expect } from '@playwright/test'

// ── Env helpers ──────────────────────────────────────────────────────────────
export function env(name: string, fallback?: string): string {
  const raw = process.env[name]
  const v = raw !== undefined && raw.trim() !== '' ? raw.trim() : fallback
  if (v === undefined || v === '') {
    throw new Error(
      'Env var ' + name + ' is missing or blank. Set it in .env.e2e at the repo root ' +
      '(copy of e2e/.env.e2e.example) and run via npm run e2e:smoke / e2e:lifecycle.'
    )
  }
  return v
}

export const URLS = {
  main: () => process.env.MAIN_URL || 'https://bespoxai.com',
  partner: () => process.env.PARTNER_URL || 'https://partners.bespoxai.com',
}

// Saved Demo1 session, written by auth.setup.ts and loaded by smoke specs.
export const DEMO1_STATE = 'e2e/.auth/demo1.json'

// A unique, easy-to-spot tag so test data can be found + cleaned up later.
export function testTag(label: string): string {
  const stamp = new Date().toISOString().slice(5, 16).replace(/[:T]/g, '')
  return `[E2E-TEST ${label} ${stamp}]`
}

// ── Login ────────────────────────────────────────────────────────────────────
// Works for both portals — the login page is shared; the portal it lands on is
// determined by the account type. Pass the base URL of the portal to start on.
//
// Makes exactly ONE sign-in attempt (lib/auth.ts rate-limits failed logins).
// The inputs are React-controlled, so values are re-checked after typing in
// case hydration reset them, and any on-page error is surfaced verbatim.
export async function login(page: Page, baseUrl: string, email: string, password: string) {
  await page.goto(baseUrl + '/login')
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

  const emailBox = page.locator('input[type="email"]')
  const pwBox    = page.locator('input[type="password"]')

  await expect(async () => {
    await emailBox.fill(email)
    await pwBox.fill(password)
    await expect(emailBox).toHaveValue(email, { timeout: 1_000 })
    await expect(pwBox).toHaveValue(password, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  // Submit — button text is "Sign in to portal →" (or "Signing in…")
  await page.getByRole('button', { name: /sign in to portal/i }).click()

  // Either we leave /login, or the page shows an error (bad password, rate limit…)
  const errorBanner = page.getByText(/Invalid email or password|Too many sign-in attempts|wrong portal/i)
  const left = page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 45_000 })
    .then(() => 'left' as const)
  const failed = errorBanner.first().waitFor({ state: 'visible', timeout: 45_000 })
    .then(() => 'error' as const)
  const outcome = await Promise.race([left, failed]).catch(() => 'timeout' as const)

  if (outcome === 'error') {
    throw new Error('Sign-in rejected for ' + email + ': "' + (await errorBanner.first().innerText()).trim() + '"')
  }
  if (outcome === 'timeout') {
    throw new Error('Sign-in did not complete within 45s for ' + email + ' (still on ' + page.url() + ')')
  }

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
