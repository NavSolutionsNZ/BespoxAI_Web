import { test as base, expect } from '@playwright/test'

/**
 * Shared test fixture: every test gets an automatic error guard.
 *
 * During the test it records:
 *   - uncaught page errors (React crashes, hydration failures)
 *   - console.error output
 *   - any /api/* response with status >= 400
 * and fails the test at the end if anything was recorded.
 *
 * Deliberately ignored:
 *   - "[Report Only]" CSP messages (the CSP is report-only by design)
 *   - Chrome's generic "Failed to load resource" console line (the network
 *     check below reports the same thing with the URL, which is more useful)
 *   - /api/csp-report
 *   - 424 UPSTREAM_FAILED (BCAgent unreachable) unless E2E_EXPECT_BC=1 — the
 *     Demo1 tenant sits on the bc22 Docker container, which isn't always on
 */

export const expectBc = process.env.E2E_EXPECT_BC === '1'

type Guard = { problems: string[] }

export const test = base.extend<{ errorGuard: Guard }>({
  errorGuard: [
    async ({ page }, use) => {
      const problems: string[] = []
      const allowed = expectBc ? [] : [424]

      page.on('pageerror', err => {
        problems.push('pageerror: ' + err.message)
      })

      page.on('console', msg => {
        if (msg.type() !== 'error') return
        const text = msg.text()
        if (text.includes('[Report Only]')) return
        if (text.startsWith('Failed to load resource')) return
        problems.push('console.error: ' + text)
      })

      page.on('response', res => {
        let path = ''
        try { path = new URL(res.url()).pathname } catch { return }
        if (!path.startsWith('/api/')) return
        if (path === '/api/csp-report') return
        const status = res.status()
        if (status >= 400 && !allowed.includes(status)) {
          problems.push('HTTP ' + status + ' ' + res.request().method() + ' ' + path)
        }
      })

      await use({ problems })

      expect(problems, 'Errors seen during the test:\n' + problems.join('\n')).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
