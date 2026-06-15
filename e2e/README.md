# BespoxAI E2E lifecycle tests (Playwright)

Repeatable browser tests that walk the **partner deliverer** and **customer**
requirement lifecycles against production, so you can re-run after each change
instead of clicking through by hand.

## What they check

- **customer-lifecycle.spec.ts** — log in as a tenant customer, create a
  requirement, confirm **auto-feasibility runs** and the **spec-generation
  entry point** appears (the thing that was missing).
- **partner-lifecycle.spec.ts** — log in as a `partner_admin`, open a client
  tenant, create a requirement, confirm auto-feasibility + spec entry point,
  then advance the deliverer pipeline (Move to Review → Issue Quote → …).

## ⚠ This touches REAL production data

Each run creates a real requirement on the test tenant. Every test requirement
title is prefixed `[E2E-TEST …]` so you can find and remove them. The partner
test defaults to `ADVANCE=safe` (stops after Issue Quote — no payment or
irreversible marks). Set `ADVANCE=full` only when you want the whole chain.

The tests **never** touch the database directly — everything goes through the
UI like a real user.

## Setup (run locally — needs a browser, which this environment doesn't have)

```bash
# from repo root
npm install -D @playwright/test dotenv-cli
npx playwright install chromium

# credentials
cp e2e/.env.e2e.example .env.e2e
#   …fill in PARTNER_PASSWORD, CUSTOMER_PASSWORD (and tenant id if different)
```

## Run

```bash
# both flows, headless
npx dotenv -e .env.e2e -- npx playwright test

# watch it click (recommended first time)
npx dotenv -e .env.e2e -- npx playwright test --headed

# just one flow
npx dotenv -e .env.e2e -- npx playwright test partner-lifecycle
npx dotenv -e .env.e2e -- npx playwright test customer-lifecycle

# full pipeline advance
ADVANCE=full npx dotenv -e .env.e2e -- npx playwright test partner-lifecycle

# step-through debugger
npx dotenv -e .env.e2e -- npx playwright test --debug
```

On failure, Playwright saves a screenshot, video, and trace under
`test-results/` and an HTML report (`npx playwright show-report`). Paste those
back and I can diagnose against the code + Vercel logs.

## Notes / known fragilities

- **Selectors** are text/role-based (e.g. the button literally reads
  "Generate Full Specification →"). If a label changes, update the matching
  `getByRole(... name: /…/)` in the spec.
- **AI steps are slow** — feasibility and spec generation can take 30–120s;
  timeouts are set generously (`waitForEither`, 150s).
- **First-login accounts**: the test account must already have completed its
  first-login password change, or `login()` will throw. If it lands on
  onboarding, set the password once by hand first.
- **MFA / Microsoft sign-in** is not handled — use a credentials account.
- These specs assume the partner customer and partner test accounts exist and
  the tenant id in `.env.e2e` is correct (Acme = `cro7hmob054poa056gtgh1540`).
