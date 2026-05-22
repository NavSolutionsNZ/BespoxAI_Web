# BespoxAI Web Portal — Files & Structure Inventory

**Last Updated:** May 22, 2026 (Session 2)

---

## ⚠️ Architecture Notes

- Live product at bespoxai.com is a full **Next.js application**
- **`public/index.html`** is the LIVE homepage — not root `index.html` (that is outdated)
- AI provider is **Anthropic Claude** (configurable via admin UI — no redeploy needed)
- BCAgent v2.4 — PowerShell HttpListener service, full deployment workflow
- GitHub per-customer repos — `lib/github.ts`, classic PAT stored as `GITHUB_CUSTOMER_REPOS_TOKEN`

---

## GitHub Repository

- **Org/Repo:** `NavSolutionsNZ/BespokeAI_Web`
- **Branch:** `main`
- **Sparse checkout (preferred):** fetch only files needed per task
- **Push command:** `git push origin master:main`
- **Note:** Remote may show redirect to `BespoxAI_Web` (capital B) — push still works

### Sparse Checkout Setup (every session)
```bash
cd /home/claude
git init repo && cd repo
git remote add origin https://{TOKEN}@github.com/NavSolutionsNZ/BespokeAI_Web.git
git sparse-checkout init
git sparse-checkout set --no-cone "components/RequirementsBuilder.tsx" "app/admin/**" "lib/**"
git pull origin main
git config user.email "claude@anthropic.com" && git config user.name "Claude"
```

New files outside sparse area: `git add --sparse <file>` then normal `git add`

---

## Production File Map

### App Pages (`/app`)

| File | Purpose |
|------|---------|
| `app/page.tsx` | Root/home page |
| `app/layout.tsx` | Root layout, fonts, session provider |
| `app/globals.css` | Global CSS variables and base styles |
| `app/dashboard/page.tsx` | Main portal. `?view=xxx` URL param persists nav tab. Back button → `router.push('/dashboard')` NOT `router.back()`. |
| `app/billing/page.tsx` | Subscription management. Back button → `router.push('/dashboard')`. |
| `app/admin/page.tsx` | Superadmin portal — 8 tabs. URL syncs selected requirement as `?tab=requirements&req={id}`. `DeployToProductionPanel` component. `DeployToTestPanel`. Coding Assistant. Dev Assistant. `BillingCharts` sub-component extracted. `renderMdLight` + `mdInlineLight` for consultant note on light backgrounds. |
| `app/login/page.tsx` | Login |
| `app/signup/page.tsx` | Signup |
| `app/signup/verify/page.tsx` | Email verification |
| `app/onboarding/page.tsx` | Post-signup onboarding |
| `app/settings/page.tsx` | Customer settings. BC Installer tab: Production (gold) + Test (green) cards. TestEnvForm uses refs + save button. Back button → `router.push('/dashboard')`. |

### API Routes (`/app/api`)

| Route | Purpose |
|-------|---------|
| `api/query/route.ts` | CFO Assistant |
| `api/requirements/route.ts` | List/create requirements. Returns all reqs incl. addenda (filtered from display in UI). Includes `addenda` nested array. |
| `api/requirements/[id]/route.ts` | GET/update/delete. PATCH fires notifications for status changes. Returns `parentId` + `addenda` in include. |
| `api/requirements/[id]/ai-spec/route.ts` | Spec gen. Returns `parentId` + `addenda` in include. |
| `api/requirements/[id]/feasibility/route.ts` | Feasibility. Returns `parentId` + `addenda` in include. |
| `api/requirements/[id]/dev-notes/route.ts` | Dev assistant streaming. Ghostwriter framing — never addresses admin. Customer-facing language only. |
| `api/requirements/[id]/dev-plan/route.ts` | Dev plan — sanitizeDevPlanJSON, buildTenantContext, max_tokens 4000+ |
| `api/requirements/[id]/coding-assistant/route.ts` | Loads C/AL from GitHub branch, streams AI response. Superadmin + developer roles. |
| `api/requirements/[id]/coding-assistant/commit/route.ts` | Commits accepted C/AL object back to GitHub branch. |
| `api/requirements/[id]/addendum/route.ts` | Creates child requirement (draft status) linked to parent. Only for deposit_paid/in_development. |
| `api/requirements/[id]/prod-approval/route.ts` | **NEW** — superadmin only. AI generates go-live doc (provider-agnostic fetch, no SDK import), saves to requirement, emails customer. Gates on uatApprovedAt. |
| `api/requirements/[id]/prod-approve/route.ts` | **NEW** — tenant_admin. Customer approves go-live doc. Sets prodApprovedAt, notifies superadmins. |
| `api/requirements/[id]/objects/route.ts` | GET + POST JSON upsert + POST multipart. On save: pushes to GitHub branch. |
| `api/requirements/[id]/objects/[fileId]/content/route.ts` | GET — download object .txt |
| `api/requirements/[id]/objects/write/route.ts` | POST — write to BCAgent Deployments folder |
| `api/requirements/[id]/objects/deploy-test/route.ts` | POST — deploy to test env. Routes to testAgentUrl if testServerSeparate. |
| `api/requirements/[id]/objects/deploy-prod/route.ts` | **NEW** — superadmin only. Triggers BCAgent prod deploy (`environment: "production"`). Sets prodDeployedAt + prodDeploySnapshotId. Emails customer. Gates on prodApprovedAt. |
| `api/requirements/[id]/fetch-objects/route.ts` | POST — streams BCAgent zip to browser |
| `api/requirements/[id]/uat-approve/route.ts` | POST — UAT sign-off, emails superadmins |
| `api/requirements/[id]/uat-reject/route.ts` | POST — AI scope-creep check |
| `api/requirements/[id]/pay-deposit/route.ts` | Deposit checkout |
| `api/requirements/[id]/pay-balance/route.ts` | Balance checkout |
| `api/requirements/[id]/submit-for-review/route.ts` | $249 Stripe checkout |
| `api/settings/route.ts` | GET/PATCH tenant |
| `api/settings/installer/route.ts` | POST — generates BCAgent installer zip |
| `api/settings/users/route.ts` | GET + POST invite |
| `api/settings/users/[id]/route.ts` | PATCH + DELETE |
| `api/settings/entities/route.ts` | PATCH entity config |
| `api/settings/discover/route.ts` | POST BC $metadata discovery |
| `api/billing/create-checkout/route.ts` | Stripe subscription checkout |
| `api/billing/status/route.ts` | Current billing status |
| `api/admin/requirements/route.ts` | Admin requirements list. Returns `requirements` (top-level) + `allAddenda` separately. Includes `addenda` nested + `assignedDeveloper`. |
| `api/admin/ai-config/route.ts` | GET/POST AI config |
| `api/admin/ai-usage/route.ts` | Token usage stats |
| `api/admin/business-config/route.ts` | Business/invoice settings |
| `api/admin/billing-stats/route.ts` | Full revenue data. `byTenant` uses `stripeCustomerId` for sub matching. Returns all deposits/balances (no cap). `reviews.list` capped at 100. |
| `api/admin/tenants/[id]/route.ts` | PATCH tenant |
| `api/admin/users/[id]/route.ts` | PATCH + DELETE |
| `api/webhooks/stripe/route.ts` | Stripe webhook. Fires `notifyAdminsDepositPaid` on deposit confirmation. |

### Components (`/components`)

| File | Purpose | Notes |
|------|---------|-------|
| `RequirementsBuilder.tsx` | Full customer flow. URL syncs selected req as `?req={id}`. `selectReq()` pushes URL. `clearReq()` removes param. `renderMdLight` + `mdInlineLight` for consultant note. Documents section (deposit/review/balance/go-live invoices). Quote hidden from customer list. Internal badges (spec, ?Nq, review paid) hidden from customers. Loading state while fetching. | May 22, 2026 Session 2 |
| `SuperAdminDashboard.tsx` | Admin overview KPIs. Attention cards navigate to requirements. `BillingCharts` called as sub-component. | May 22, 2026 |
| `BillingCharts` (inside SuperAdminDashboard.tsx) | **Extracted sub-component** — revenue composition donut, monthly activity drill-downs, customers by value stacked bar. Extracted to avoid SWC large-function limits. Do NOT merge back. | May 22, 2026 |
| `RevBar` (inside SuperAdminDashboard.tsx) | Tiny helper for stacked bar segments. Returns null if pct ≤ 0. | May 22, 2026 |
| `UpgradePrompt.tsx` | Token limit prompt | — |
| `DataVisualizer.tsx` | BC query result rendering | — |
| `MigrationAnalyzerLanding.tsx` | Migration analyser | — |

### Lib Files (`/lib`)

| File | Purpose |
|------|---------|
| `tenant-context.ts` | `buildTenantContext(tenantId)` — BC env + entity config + customisation history. No object summaries. 5-min cache. `resolveBcVersion()`. `invalidateTenantContext()`. |
| `github.ts` | Per-customer GitHub repos. `pushObjectsToGitHub()`, `getFile()`, `listFiles()`, `pushFiles()`, `ensureRepo()`, `ensureBranch()`. Env: `GITHUB_CUSTOMER_REPOS_TOKEN` |
| `notifications.ts` | All requirement lifecycle emails. Fire-and-forget. Includes prod deployment: `notifyCustomerProdApproval`, `notifyAdminsProdApproved`, `notifyCustomerProdDeployed`. |
| `ai-config.ts` | `getAiConfig()` — DB-driven, 60s cache |
| `ai-usage.ts` | `logAiUsage()` fire-and-forget. Feature values: `dev_assistant`, `coding_assistant`, `spec_gen`, `dev_plan`, `feasibility`, `cfo_query` |
| `bc-object-parser.ts` | `parseObjectFile()` — generates rich summaries |
| `business-config.ts` | `getBusinessConfig()` |
| `stripe-fees.ts` | GST + surcharge logic |
| `tier.ts` | Token limits + checking |
| `cloudflare.ts` | Tunnel token fetching |
| `email.ts` | `sendEmail()` — used by notifications and UAT routes |
| `auth.ts`, `db.ts`, `stripe.ts`, `tenants.ts` | Core infrastructure |

### Scripts (`/scripts`)

| File | Purpose |
|------|---------|
| `Install-BespoxAI.ps1` | BCAgent v2.4 installer template. Config JSON version: 2.4 |

### Other Key Files

| File | Purpose |
|------|---------|
| `public/index.html` | **LIVE** marketing homepage |
| `middleware.ts` | NextAuth route protection |
| `next.config.js` | Next.js config |
| `prisma/schema.prisma` | Full schema |
| `package.json` | Next.js ^14.2.29, React ^18.3.1 |

---

## Database Schema — Key Models

### Requirement
```
status: draft | submitted | needs_clarification | in_review | quoted | quote_rejected |
        deposit_required | deposit_paid | in_development | complete_pending_payment |
        fully_paid | rejected

quote, quoteApprovedAt, quoteRejectedAt, quoteRejectionReason
depositAmount, depositPaidAt, depositStripeSessionId, depositBypassed
balancePaidAt, balanceStripeSessionId
reviewPaidAt, reviewStripeSessionId, reviewBypassed, reviewIncluded, reviewSubmittedAt
poNumber, consultantNote

-- Deployment & UAT
testDeploySnapshotId  String?
testDeployedAt        DateTime?
uatApprovedAt         DateTime?
uatRejectedAt         DateTime?
uatRejectionReason    String?   @db.Text
uatRejectionAnalysis  Json?

-- Production deployment (NEW Session 2)
prodApprovalSentAt   DateTime?          -- when go-live doc emailed to customer
prodGoLiveDoc        String?  @db.Text  -- AI-generated go-live summary
prodApprovedAt       DateTime?          -- when customer approved
prodApprovedById     String?            -- userId who approved
prodDeployedAt       DateTime?          -- when BCAgent prod deploy completed
prodDeploySnapshotId String?            -- BCAgent snapshot ID used

-- GitHub & Developer
githubBranch          String?
assignedDeveloperId   String?
assignedDeveloper     User?     @relation("RequirementDeveloper")

-- Addenda
parentId  String?    -- set on addenda; null on top-level requirements
parent    Requirement?   @relation("RequirementAddenda")
addenda   Requirement[]  @relation("RequirementAddenda")
```

### Tenant
```
navProduct, navVersion, lastCU
bcPort, agentPort
navDatabaseServer, navDatabaseName, navServerInstance
stripeCustomerId     String?   -- used for subscription→tenant revenue matching
stripeSubscriptionId String?
stripePriceId        String?

-- Test environment
testNavDatabaseServer, testNavDatabaseName, testNavServerInstance
testBcPort, testBcInstance, testBcCompany, testAgentPort

-- Separate test server
testServerSeparate     Boolean  @default(false)
testAgentUrl           String?
testTunnelToken        String?
testAgentPort          Int?

-- GitHub
githubOrg              String?
githubRepo             String?
```

### User
```
role: "superadmin" | "tenant_admin" | "user" | "developer"
assignedRequirements  Requirement[]  @relation("RequirementDeveloper")
```

---

## Stripe Payment Flows

| Flow | Route | Success URL |
|------|-------|-------------|
| Subscription | `/api/billing/create-checkout` | `?billing=success` |
| Spec review | `/api/requirements/[id]/submit-for-review` | `?review=paid` |
| Deposit | `/api/requirements/[id]/pay-deposit` | `?deposit=paid` |
| Balance | `/api/requirements/[id]/pay-balance` | `?balance=paid` |

---

## Admin Portal Tabs
```
overview | tenants | users | entities | signups | requirements | settings | business
```

## Environment Variables (Vercel)
| Var | Purpose |
|-----|---------|
| `GITHUB_CUSTOMER_REPOS_TOKEN` | Classic PAT (repo scope) for per-customer GitHub repos |
| `NEXTAUTH_SECRET` | NextAuth session secret |
| `DATABASE_URL` | Vercel Postgres connection string |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `ANTHROPIC_API_KEY` | Claude API key |

## What NOT to Do

- ❌ Don't edit root `index.html` — edit `public/index.html`
- ❌ Don't use any GitHub username other than `NavSolutionsNZ`
- ❌ Don't use `view=requirements` — not a valid NavItem
- ❌ Don't assume api.github.com works — it's blocked
- ❌ Don't run `prisma migrate` — use `db push` or raw SQL
- ❌ Don't forget `git config user.email/name` before committing
- ❌ Don't use `git push origin main` — use `git push origin master:main`
- ❌ Don't add outside-sparse-area files without `git add --sparse <file>` first
- ❌ Don't use `&&` shortcircuit JSX in large functions — use `cond ? <JSX/> : null`
- ❌ Don't use template literals `${var}` in JSX — use string concatenation
- ❌ Don't use template literals in JSX text nodes — wrap as `{'text: $'+val}`
- ❌ Don't merge BillingCharts back into SuperAdminDashboard — it's extracted for SWC
- ❌ Don't use Python heredocs for fix scripts — write to `/tmp/fix_xxx.py` files
- ❌ Don't use `str_replace` with strings that appear more than once — use Python `content.replace(..., 1)`
- ❌ Don't push without checking imports — TypeScript errors from missing imports waste deploy cycles
- ❌ Don't import `@anthropic-ai/sdk` in API routes — use provider-agnostic fetch pattern (see prod-approval/route.ts)
- ❌ Don't use `React.useState` in standalone functions outside the main component — use destructured `useState`
- ❌ Don't use `router.back()` anywhere — always use explicit `router.push('/dashboard')` or `router.push('/admin?tab=...')`
