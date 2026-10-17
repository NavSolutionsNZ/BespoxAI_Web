# BespoxAI E2E tests (Playwright)

Browser tests that run against production (or a preview) through the UI like a
real user. They never touch the database directly.

## Two tiers

| Tier | Command | Writes data? | Time | When |
|---|---|---|---|---|
| **Smoke** | `npm run e2e:smoke` | No | ~1–2 min | After every deploy |
| **Lifecycle** | `npm run e2e:lifecycle` | Yes — real `[E2E-TEST …]` requirements | Minutes (AI) | On purpose, before releases |

### Smoke (`e2e/smoke/`)

- **public.spec.ts** — `bespoxai.com` home, `/login`, `/signup`, `/demo`, and
  `partners.bespoxai.com` home, `/signup`, `/login` load and show their headings.
- **demo1.spec.ts** — signed in as the Demo1 tenant user, the CFO Assistant,
  Health Scanner, Customisations and Migration Analyser views render.
  (Cash Flow / Month-End Close are "soon" placeholders and skipped.)
- **BC round-trip** (opt-in, `E2E_EXPECT_BC=1`) — the agent badge shows
  connected and one CFO question returns an answer. Needs the bc22 Docker
  container running; spends AI tokens.

Every smoke test also fails on uncaught page errors, `console.error`, or any
`/api/*` response ≥ 400 (`e2e/fixtures.ts`). With `E2E_EXPECT_BC` off, 424
(agent unreachable) is tolerated.

Sign-in happens once (`auth.setup.ts`) and the session is reused from
`e2e/.auth/demo1.json` (gitignored).

### Lifecycle

- **customer-lifecycle.spec.ts** — customer creates a requirement, auto-feasibility
  runs, spec generation entry point appears.
- **partner-lifecycle.spec.ts** — partner_admin creates a requirement on a client
  tenant and advances the pipeline. `ADVANCE=safe` (default) stops after Issue
  Quote; `ADVANCE=full` walks the whole chain.

⚠ Not yet verified against the current UI — slice 2 hardens these.

## Setup (once, on your PC)

```bash
# from repo root
npm install
npx playwright install chromium

cp e2e/.env.e2e.example .env.e2e
#   fill in DEMO_EMAIL / DEMO_PASSWORD (smoke)
#   and PARTNER_* / CUSTOMER_* (lifecycle)
```

Test accounts must have finished first-login setup — `login()` throws if the
account lands on onboarding or a password-change screen. MFA / Microsoft
sign-in isn't handled; use a credentials account.

## Run

```bash
npm run e2e:smoke                       # smoke, headless
npm run e2e:smoke -- --headed           # watch it click
npm run e2e:smoke -- -g "partner"       # only tests matching a name
npm run e2e:lifecycle                   # lifecycle (writes data)
npm run e2e:report                      # open the last HTML report
```

`E2E_EXPECT_BC=1` and `ADVANCE=full` can go in `.env.e2e` or be set in the shell.

On failure Playwright saves a screenshot, video and trace under
`test-results/`, plus the HTML report. Paste the failure output back and it can
be diagnosed against the code and Vercel logs.

## Cleaning up lifecycle test data

`scripts/e2e-cleanup.sql` — run the PREVIEW query first in Vercel → Storage →
Postgres → Query, check the list, then run the CLEANUP block. It removes
`[E2E-TEST …]` requirements, their addenda and uploaded object files; AI usage
rows are kept with the requirement link cleared. Any `req/…` GitHub branches
created for those requirements are not touched.

## Notes

- Selectors are text/role-based. If a heading or button label changes, update
  the matching `getByRole(... name: /…/)`.
- Tests run serially (`workers: 1`) against production on purpose.
