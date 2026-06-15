# BespoxAI Web Portal — Project Summary

**Project Owner:** Rich Lancaster (richard.lancaster — Windows/MINGW64 environment)
**Current Status:** Full Next.js application deployed to Vercel. Live at bespoxai.com.
**Repository:** NavSolutionsNZ/BespoxAI_Web (GitHub) — renamed from BespokeAI_Web
**Hosting:** Vercel (auto-deploys on push to main)
**Created:** April 2026
**Last Updated:** June 16, 2026 (Session 24)

---

## ⚠️ Critical Architecture Note

**This is NOT a single HTML file project.** The live production site at bespoxai.com is a full **Next.js application** with:
- App Router (`/app` directory)
- NextAuth authentication
- Prisma ORM + PostgreSQL (Vercel Postgres)
- Stripe billing
- Cloudflare tunnel for BC/NAV connectivity
- Multiple API routes
- AI provider switchable (OpenAI or Anthropic — use fetch pattern, not SDK)
- GitHub per-customer repos

**Marketing pages:** `public/index.html` — the LIVE homepage

---

## GitHub Access

- **Repo:** `NavSolutionsNZ/BespoxAI_Web` (renamed from BespokeAI_Web — old URL still redirects)
- **Branch:** `main`
- **Claude uses sparse checkout** — never clones the full repo. Include `"prisma"` and context files in set.
- **api.github.com is blocked** — but `github.com` git operations work
- **Push:** `git push origin master:main`
- **Remote URL:** `https://{TOKEN}@github.com/NavSolutionsNZ/BespoxAI_Web.git`

### Sparse Checkout Setup (every session)
```bash
cd /home/claude
git init repo && cd repo
git remote add origin https://{TOKEN}@github.com/NavSolutionsNZ/BespoxAI_Web.git
git sparse-checkout init
git sparse-checkout set --no-cone "app" "components" "lib" "scripts" "prisma" "BESPOXAI_PROJECT_SUMMARY.md" "BESPOXAI_COMPONENT_ROADMAP.md" "BESPOXAI_FILES_INVENTORY.md"
git pull origin main
git config user.email "claude@anthropic.com" && git config user.name "Claude"
```

---

## Session 24 Key Changes (June 16, 2026) — Branding cache fix, partner AI entry points, relationship model, E2E tests

**Theme of session:** correcting the **partner/customer relationship model** and the bugs that flowed from misunderstanding it. See the new **"🧭 THE RELATIONSHIP MODEL"** section at the top of `BESPOXAI_FILES_INVENTORY.md` — it is now the authoritative reference for who is deliverer vs customer in each pipeline. Read it before any requirements/branding/auth work.

### 1. Partner-customer branding fix (`d82af65`)
- **Bug:** Acme (customer of white-label partner Test Partner Ltd / "Endeavour") saw **BespoxAI** branding in their portal instead of Endeavour's.
- **Root cause:** the admin partner-edit route (`/api/admin/partners/[id]` PATCH) updated branding fields but never called `revalidateTag('branding')`, so managed customers kept serving a stale per-user branding cache from before the white-label flip. (`revalidateTag` previously only fired on the partner's own PATCH + the stripe webhook — not the admin path a superadmin actually uses.)
- **Fixes:** (1) `app/api/admin/partners/[id]/route.ts` PATCH now `revalidateTag('branding')` when `isWhiteLabel`/`brandName`/`logoUrl`/`agentBrandName` change; (2) `app/api/admin/partners/route.ts` POST busts the tag when a partner is created white-label; (3) `lib/branding.ts` `resolveBranding` now **gates on `isWhiteLabel`** — returns `DEFAULT_BRANDING` unless the partner is white-label (defense-in-depth + honest API response). Data was already correct; this was cache + missing gate.
- **STANDING RULE added:** any route that mutates partner branding fields MUST `revalidateTag('branding')`.

### 2. Partner AI entry points — mirror BespoxAI auto-feasibility + spec generation (`0e6a6be`)
- **Bug (Rich, testing):** creating a requirement as a partner gave "no AI assistant functionality" — just text. The partner detail had the feasibility/ai-spec **routes and handlers** (S23) but **no UI entry point**: the feasibility card only rendered after a check existed; the spec card only after a spec existed. A fresh requirement was inert.
- **Fix (`app/partner/tenants/[id]/page.tsx`):** mirror the BespoxAI customer flow (`RequirementsBuilder`):
  - **Auto-run feasibility** when a pre-quote requirement has no verdict yet (effect + ref guard; fires once on open, covers new + pre-existing reqs).
  - **Verdict-driven CTAs** in the feasibility card: `development` → "Generate Full Specification →", `cfo_assistant` → "Scope as development anyway" (both call existing `generateSpec`); `infeasible` → constrained badge + notes.
  - Loading state while feasibility runs.
- Reuses existing partner routes/handlers; no backend/schema change. SWC-validated.
- **Partner CUSTOMER side already worked:** partner customers use `RequirementsBuilder` (Customisations view), which already auto-runs feasibility on create, and the direct feasibility/ai-spec routes accept a partner-tenant customer (`tenantId === user.tenantId`). No change needed there.

### 3. Partner pipeline parity audit (`PARTNER_PIPELINE_PARITY_AUDIT.md`, repo root — NEW)
- Full map of every lifecycle capability, deliverer + customer, direct vs partner. Direct pipeline = 28 requirement routes; partner = 10. **Known remaining gaps on the partner-deliverer side (NOT yet built):**
  - **Developer assignment/reassign** (partner has only auto-assign-to-creator; no reassign UI/API). Plus the **customer-leak bug** still live: `RequirementsBuilder` shows Reassign to `tenant_admin`/`partner_admin` (customer roles) and the direct `/api/requirements/[id]/assign` route permits `tenant_admin` — customers must NEVER assign. **Not yet fixed.**
  - **Mark "unable to complete"** (partner_developer self-service) — missing.
  - **Addendum** (post-acceptance scope change) — missing.
  - **Objects + deploy** (fetch/sync/write/**deploy-test**/**deploy-prod**) — missing. BIGGEST gap: partner can AI-author + commit C/AL but cannot deploy to the customer's BC, so the lifecycle stalls at `in_development`. Needs its own design pass (partner deploys via the customer tenant's BCAgent/tunnel).
  - **Prod go-live approval** (`prod-approval`/`prod-approve`) — missing.
- Superadmin posture on partner tenants: **read-only** (see state, cannot reassign/drive delivery).

### 4. E2E test suite (NEW — `e2e/` + `playwright.config.ts`)
- Playwright lifecycle tests, run **locally** against production (no browser in Claude's env). `partner-lifecycle.spec.ts` (partner_admin: create → auto-feasibility → spec → advance pipeline) + `customer-lifecycle.spec.ts` (customer: create → auto-feasibility → spec). Text/role-based selectors off real labels. Touches real prod data — test reqs tagged `[E2E-TEST …]`; partner advance defaults `ADVANCE=safe` (stops after Issue Quote). Creds via `.env.e2e` (gitignored; example at `e2e/.env.e2e.example`). See `e2e/README.md`.
- `.gitignore` updated: `.env.e2e`, `/test-results/`, `/playwright-report/`.

### Next session priorities (post relationship-model correction)
1. **Customer reassign leak** — remove deliverer/assignment UI from customers in `RequirementsBuilder`; lock `/api/requirements/[id]/assign` to deliverer-only (direct = superadmin). Add superadmin read-only gate on partner tenants in admin view.
2. **Partner assignment system** — reassign UI (workload modal) + `assign`/`mark-unable` partner routes, gated `partner_admin`, candidates = that partner's `partner_admin`+`partner_developer`.
3. **Partner objects + deploy** pipeline (largest; own design pass).
4. **Addendum** + **prod go-live approval** partner parity.

---

## Session 23 Key Changes (June 15, 2026) — Partner AI requirements parity, theme system, shared components

**Goal:** mirror the BespoxAI AI requirements experience into the partner portal (AI spec refinement + dev tooling), add a dark/light theme toggle, and begin collapsing partner↔admin duplication into shared components.

**⚠️ ALL OF SESSION 23 IS PENDING RICH'S TEST SIGN-OFF.** Deployed green on Vercel but not yet functionally verified end-to-end. See "Session 23 — Test checklist" below.

### Six commits (all deployed green)
1. `1bfcfad` — **Partner notification portal-link fix**
2. `1384ca0` — **Slice 1: partner AI parity routes + referral tier**
3. `085a603` — **Slice 2: partner AI panels + collapsible cards**
4. `3168858` — **Slice 3 Stage A: dark/light theme system + toggle**
5. `d50a04b` — **Slice 3 Stage B: shared DevPlanPanel (partner + admin)**
6. (context update commit — this session close-out)

### 1. Notification portal-link fix (`1bfcfad`)
- **Bug:** partner emails (welcome, team-welcome, new requirement, answered, quote-rejected, UAT) built links from `PORTAL` (= `NEXTAUTH_URL ?? bespoxai.com`), sending partners to the **main** portal → login detected partner-on-wrong-domain → "wrong portal" redirect loop.
- **Canonical partner domain = `partners.bespoxai.com`** (plural; confirmed on Vercel project domains). Singular `partner.bespoxai.com` does NOT exist anywhere — partner had mistyped.
- **Fix:** added `PARTNER_PORTAL = process.env.PARTNER_PORTAL_URL ?? 'https://partners.bespoxai.com'` in `lib/notifications.ts`; repointed all partner links to it. Admin (`/admin`) + direct-customer (`notifyCustomer*` → `/dashboard`, "your portal") links stay on `PORTAL`.
- Also removed the legacy Partner Agreement **PDF** link from `notifySendPartnerAgreement` (replaced by the scrollable accept-in-portal version; PDF still referenced at `app/partners/resources/agreement/page.tsx:38` — left untouched).
- Login page (`app/login/page.tsx`) was already correct (plural) — unchanged.

### 2. Slice 1 — Partner AI parity routes + referral tier (`1384ca0`)
- **Schema:** `PartnerAccount.partnerTier` (`'self_serve' | 'referral'`, default `self_serve`). SQL applied: `ALTER TABLE "PartnerAccount" ADD COLUMN IF NOT EXISTS "partnerTier" TEXT NOT NULL DEFAULT 'self_serve';`
  - **referral** = partner only creates/sets up the tenant; BespoxAI manages requirements directly with the customer (minimal tier). Gets a 403 on the dev routes.
  - **self_serve** = partner runs the full in-portal requirements pipeline themselves. Gets full AI tooling.
  - Referral % / billing mechanics deliberately **deferred** to a later session.
- **`lib/partner-auth.ts`:** added `assertPartnerCanDevelop(partnerAccountId)` (throws for referral → caller 403s) and `getPartnerTier(partnerAccountId)` (returns tier, defaults self_serve).
- **5 new partner routes** under `app/api/partner/tenants/[id]/requirements/[reqId]/`, each mirroring its direct `/api/requirements/[id]/...` counterpart with: `requirePartnerSession` + `assertTenantBelongsToPartner` + `assertPartnerCanDevelop`, `findFirst({ id: reqId, tenantId: id })` scoping, provider-agnostic AI via `getAiConfig()` (global AI Setup governs partner AI too):
  - `feasibility/route.ts`
  - `dev-plan/route.ts` (OpenAI branch converted off the SDK to `fetch` — no top-level `new OpenAI()`)
  - `dev-notes/route.ts` (ghostwrites as the **partner consultant + partner brand**, not BespoxAI — fetches `brandName`/`name` from the account; consultant name from the session user)
  - `coding-assistant/route.ts` + `coding-assistant/commit/route.ts` (reuses existing `resolvePartnerToken` for partner-org GitHub with BespoxAI fallback)

### 3. Slice 2 — Partner AI panels + collapsible cards (`085a603`)
- All UI in `app/partner/tenants/[id]/page.tsx` (`RequirementDetail` component). Partner detail is a **self-contained implementation** — does NOT use `components/RequirementsBuilder.tsx`.
- **`CollapsibleCard`** component (defined outside the main component, SWC rule) with **status-based default collapse** mirroring admin: panels fold once past their focus stage (`defaultCollapsed(cardKey)` + `isCollapsed`/`toggleCard`).
- **Seven cards** made collapsible: Description, Feasibility, AI Spec, Dev Plan, AI Dev Assistant, Coding Assistant, Q&A.
- **Feasibility panel** — renders `feasibility`/`feasibilityNotes`/`feasibilityCostRange` (previously stored but never shown) with classification badges + manual recheck.
- **Dev Plan panel** — generate/regenerate, full rendering (later extracted to shared component in Stage B).
- **AI Dev Assistant** — SSE streaming chat (Anthropic `content_block_delta`/`text_delta`, line-buffered).
- **Coding Assistant** — SSE streaming + `extractCalObjects` (C/AL OBJECT block regex) + per-object commit-to-GitHub with committed state. Shows "no branch linked" if `req.githubBranch` is null.
- Dev panels show in `quoted`→`fully_paid` stages.
- **`Requirement` type extended:** `devPlan`, `feasibilityCheckedAt`, `githubBranch`.
- **Tier-gated `devPlan` return:** partner GET (list) + `[reqId]` GET/PATCH previously stripped `devPlan` ("superadmin-only"). Now returns it for **self_serve**, strips for **referral** (via `getPartnerTier`). Needed so the Dev Plan panel populates on load.

### 4. Slice 3 Stage A — Dark/light theme system + toggle (`3168858`)
- **Semantic CSS-variable layer** in `app/globals.css`: `[data-rb-theme="dark"]` (original partner palette) and `[data-rb-theme="light"]` (BespoxAI parchment palette), ~22 `--rb-*` vars (bg, surface, surface-2, inset, code, border, border-strong, text, text-bright, text-muted, accent, accent-soft, success, primary, primary-hover, danger, danger-soft, warning, warning-soft, hover, active).
- **Schema:** `PartnerAccount.partnerTheme` (`'dark' | 'light'`, default `dark` to preserve existing look). SQL applied: `ALTER TABLE "PartnerAccount" ADD COLUMN IF NOT EXISTS "partnerTheme" TEXT NOT NULL DEFAULT 'dark';`
- **`app/partner/partner-theme-provider.tsx`** (new) — fetches `/api/partner/account` → `partnerTheme`, exposes `usePartnerTheme()` context, defaults dark until loaded.
- **`app/partner/layout.tsx`** — wraps portal in `PartnerThemeProvider`; inner `PartnerLayoutInner` consumes theme + sets `data-rb-theme` on root div (and the loading-state div).
- **`app/partner/settings/page.tsx`** — new **Appearance** section: Dark/Light toggle, persists via `saveSection('theme', { partnerTheme })` + applies live via `setTheme`. **Admin-only** (account-wide setting; non-admins see disabled toggle + note).
- **`app/api/partner/account/route.ts`** — `partnerTheme` added to GET select + PATCH scalar fields (PATCH is `partner_admin` only).
- **Full re-theme:** 431 hardcoded hex → `var(--rb-*)` across all 7 partner files; 20 input/inset surfaces mapped to `--rb-inset` (distinct sunken surface) for correct light-mode contrast. Dark output unchanged (same hex via vars). Light mode **visually confirmed by Rich**.
- No React portals in partner files → everything inherits `data-rb-theme` scope.

### 5. Slice 3 Stage B — Shared DevPlanPanel (`d50a04b`)
- **`components/DevPlanPanel.tsx`** (new) — theme-agnostic (references only `--rb-*`), consumed by BOTH partner detail + admin. Renders the full superset (summary, field audit, approach, tasks+code snippets, effort summary, risks, testing, deployment). `showPricing` prop gates BespoxAI-internal commercial guidance (day rate, suggested quote, quoting notes).
- **Partner:** `<DevPlanPanel showPricing={false} />` — partners are the quoter for their own clients but see **hours/days only, NEVER BespoxAI's suggested pricing** (Rich's explicit call). Replaced 96-line inline block.
- **Admin:** `<DevPlanPanel showPricing={true} />` wrapped in `data-rb-theme="dark"` (the admin dev-plan card was always dark-themed via `var(--ink)`; renders via dark `--rb-*` now). Replaced 174-line inline block.
- Net: 261 lines of duplication removed.
- **Remaining Slice 3 work (future):** the other 3 AI panels (feasibility, dev-notes, coding-assistant) still have parallel partner/admin implementations — extend the same shared-component pattern in future sessions.

### Session 23 — Test checklist (Rich to verify before sign-off)
1. **Notification links:** trigger a partner email (e.g. invite a team member) → link goes to `partners.bespoxai.com`, login works without wrong-portal error.
2. **Theme toggle:** Settings → Appearance → switch Light/Dark → whole portal re-themes instantly; flip back to Dark = identical to before. Check status badges/pipeline dots (still use `STATUS_COLOR` hex, not `--rb-*`) read OK on light.
3. **Admin Dev Plan:** open a requirement in admin (status in_review/quoted/in_development) → generate Dev Plan → renders correctly (effort boxes, field-audit, pricing block still present since `showPricing={true}`). Should look ~identical to pre-Session-23.
4. **Partner Dev Plan:** open a self_serve partner tenant requirement (quoted→fully_paid) → generate → renders with hours + **Est. Days**, **no pricing**.
5. **Partner AI panels:** Feasibility (badges + recheck), AI Spec (collapsible), Dev Assistant (streams), Coding Assistant (streams; commits a C/AL object — requires `githubBranch` linked on the requirement, else shows "no branch" message).
6. **Referral tier:** if any partner is set to `partnerTier='referral'` (none are by default), the 5 dev routes should 403 and devPlan is stripped. All current partners default `self_serve`.

**Known non-blocking notes for testing:**
- Admin Dev Plan colors moved from `var(--ink)`/`var(--jade)`/`var(--amber)` to dark `--rb-*` equivalents — close but not pixel-identical. If anything reads off, adjust the dark `--rb-*` values in `globals.css`.
- Coding Assistant commit needs a linked GitHub branch; if a test requirement has none, that's expected behaviour, not a bug.

---



All five partner-portal bugs from the Session-22 walkthrough log fixed and deployed green. Full detail in the roadmap's "Partner-Portal Bugs — ALL RESOLVED" section.

- **Bug 1 (`60d376a`):** partner create-requirement 500. Real cause was the required non-nullable `assignedDeveloperId` FK (no DB default) never being set — NOT GitHub provisioning/AI spec as first theorised. Now sets `assignedDeveloperId: session.userId`.
- **Bug 4 (`745154e`):** partner can now edit title/description/bcArea/priority before submit/resubmit (UI-only gap; API already accepted the fields). Mirrors the customer resubmit flow.
- **Bug 2 + 3 (`54de318`, `4fafba9`, `17e0f0d`):** full partner **deliverer** action set. Partner detail is BOTH customer and deliverer. Added deliverer transitions to partner PATCH; new partner `uat-approve`/`uat-reject` routes (reject mirrors the AI scope-creep analysis); status-gated Delivery Actions UI card. **Payments are manual marks — no Stripe in the partner pipeline.**
- **Bug 5 (`5d684bb`):** Connected/Not-Connected pill (`!!tunnelId`) separate from the account Active badge, on both partner dashboard and admin tenant lists.
- **Notifications (`7900605` + wired through Bug 2):** partner pipeline emails now route to partner (deliverer) / client-tenant customer / BespoxAI-billing correctly — previously all went to BespoxAI superadmins. New `getPartnerRecipients()` + `notifyPartner*` helpers; direct pipeline untouched.

### Key correction recorded
The Bug 1 GitHub-provisioning theory in the original log was wrong. The actual class is the standing **required-FK-without-default** trap: when mirroring a `create` across pipelines, verify required FKs that have no DB default are set.

### Deferred from Session 22
- Partner Stripe payments (`paymentMode` stored/surfaced but drives no logic; deposit/balance are manual marks).
- BespoxAI billing-visibility email copies beyond `deposit_paid` (quoted/accepted/completed).
- Live agent-health connection indicator (current pill = tunnel provisioned, not reachable-now).
- **Production test-data cleanup (Rich):** tenant Demo Wholesale Ltd (`cmqd4nvlm0001l9mcrs7by193`), partner user Jordan Lee (`jordan.lee@example-demo.test`), and reset `partner@testpartner.com` password.

---

## Session 21 Key Changes (June 11, 2026)

### Partner flow fixes
- **Post-payment redirect:** `app/api/partner/billing/create-checkout/route.ts` success_url/cancel_url were pointing at `/settings` (customer portal) → partner landed in CFO Assistant area. Fixed to `/partner/settings?billing=success` and `/partner/settings`.
- **Activation cache-bust:** newly-activated partner was invisible for up to 60s (neither pending nor in accounts list). `app/api/admin/partners/[id]/activate/route.ts` now calls `revalidateTag('admin-partners')`; `app/api/admin/partners/route.ts` cache tagged `['admin-partners']`.
- **Email send logging:** `lib/email.ts` sendEmail now logs accepted/rejected/response and re-throws on hard failure. Return type kept `Promise<void>` (no caller uses a return value — returning the nodemailer `info` object broke the build in `partner/request/route.ts`).
- **Resend partner welcome:** NEW route `app/api/admin/partners/[id]/resend-welcome/route.ts` (superadmin-only) — generates a fresh temp password (original is bcrypt-hashed/unrecoverable), re-hashes onto the partner_admin user with mustChangePassword:true, calls notifyPartnerWelcome, returns 502 if email throws. UI: "Resend welcome" button per partner row in admin Partners tab.

### White-label persistence — THE BIG BUG (fixed)
- **Symptom:** partner paid for branded plan but subscriptionTier stayed 'unbranded'/isWhiteLabel=false; settings kept demanding upgrade.
- **Root cause:** `app/api/webhooks/stripe/route.ts` did `partnerAccount.findUnique({where:{stripeCustomerId}})` but stripeCustomerId was NOT @unique → Prisma threw "Argument where needs at least one of id or slug", webhook swallowed it and returned 200.
- **Fix:** both partner lookups (handleSubscriptionChange + handleSubscriptionDeleted) switched to `findFirst`; added `@unique` to `PartnerAccount.stripeCustomerId` in schema. SQL run: `CREATE UNIQUE INDEX IF NOT EXISTS "PartnerAccount_stripeCustomerId_key" ON "PartnerAccount" ("stripeCustomerId");`
- Webhook maps branded price → tier='branded'+isWhiteLabel=true via getPartnerPlanByPriceId. Confirmed persisting (Test Partner Ltd, cus_UeUI0MfIq09lUb, Stripe TEST mode).

### White-label logo not rendering without hard refresh (fixed, separate bug)
- **Root cause:** BrandingProvider (`app/branding-provider.tsx`) fetched `/api/branding` with no cache control → browser served stale default-branding on soft nav.
- **Fix:** (1) client fetch `cache:'no-store'`; (2) `app/api/branding/route.ts` server `unstable_cache` tagged `['branding']`; (3) `revalidateTag('branding')` added in `app/api/partner/account/route.ts` PATCH and in the stripe webhook on white-label flip on/off.

### Admin Users tab — type labelling + filter
- `app/api/admin/users/route.ts` query extended to include `partnerUsers{role,partnerAccount{name,tenants{id,name}}}` and `tenant{partnerAccount{name}}`.
- `app/admin/page.tsx`: `classifyUser(u)` helper (defined OUTSIDE component) returns {type, partnerName, managedTenants}. Types: **Partner** (blue), **Partner Customer** (green), **Direct** (grey), **Internal** (amber = superadmin/developer). New "Type" column with badge + partner name, plus a "Filter by type" dropdown.
- Classification rule: PartnerUser record → partner; tenant.partnerAccount set → partner_customer; superadmin/developer → internal; else direct.
- For **Partner** users the Tenant column lists the partner account's managed tenants as green pills (first 3 + "+N more" + full-list hover tooltip), "no tenants yet" if none.

### Customers cannot be made developers (fixed)
- Developers are internal BespoxAI staff; partner *staff* CAN still be devs; customers (Direct + Partner Customer, i.e. any tenant-tied user) cannot.
- UI (`app/admin/page.tsx`): `canBeDeveloper(u)` helper; for customers the role cycle becomes user↔tenant_admin (button reads "→ User" not "→ Dev"). `toggleUserRole(u)` now takes the full user object.
- API (`app/api/admin/users/[id]/route.ts`): rejects role:'developer' with 403 if target.tenantId is set.
- Partner portal needs NO equivalent fix: partner client-tenant page shows client roles read-only, and the partner users API only handles partner_admin|partner_developer — it can never assign the platform developer role.

### /api/health 500 every minute (fixed)
- **Symptom:** partners.bespoxai.com logged a Prisma 500 every 60s (dashboard polls /api/health).
- **Root cause:** partner/superadmin users have tenantId:null; route called getTenantById(null) → `findUnique({where:{id:null,active:true}})` → same "needs at least one of id" Prisma error.
- **Fix:** (1) `app/api/health/route.ts` guards null tenantId → returns 200 {status:'no_tenant'}; (2) `lib/tenants.ts` getTenantById made null-safe (`if(!tenantId)return null`) and switched findUnique→findFirst (also protects bc-test, query, settings/discover callers). Confirmed: error stream clean post-deploy.

### Email deliverability — DKIM/DMARC (infra, Rich did this)
- Dean (deanh@endeavour.co.nz) was receiving ZERO partner emails. bespoxai.com had SPF only, no DKIM, no DMARC → nodemailer "succeeded" (SMTP accepted) but mail silently dropped.
- DNS is in **Cloudflare** (nameservers jakub/val.ns.cloudflare.com); domain registered at Spaceship/Spacemail.
- Added in Cloudflare DNS: DKIM TXT `spacemail._domainkey` (2048-bit RSA, value from Spaceship support), DMARC TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:postmaster@bespoxai.com`. Verified green on mxtoolbox. Can tighten p=none→quarantine later once rua reports look clean.

### Recurring lesson this session
- `findUnique` only accepts unique fields and throws on null — this bug class recurred 3× (stripe webhook, getTenantById, health). **Use `findFirst` for any non-unique or nullable filter.**

---

## Session 20 Key Changes (June 7, 2026)

### Partner Login Cross-Domain Redirect
- **Problem:** Partner users signing in to main bespoxai.com portal instead of partners.bespoxai.com would get stuck or see wrong UI
- **Solution:** Portal mismatch detection — after sign-in, portal checks user type and redirects to correct domain
  - `app/login/page.tsx`: Added `useEffect` to detect partner portal from hostname
  - `app/api/auth/me/route.ts` (NEW): Returns `{ id, email, firstName, preferredName, partnerAccountId, role }` from session
  - `lib/auth.ts`: Minimal redirect callback — `async redirect({ url }) { return url }`
  - `app/dashboard/page.tsx`: Added 1-second timeout session guard redirects to `/login` if no session
  - Post-signin flow: checks `/api/auth/me` to see if user has `partnerAccountId`
    - If user is non-partner but signed in via partners.bespoxai.com → redirect to bespoxai.com with email pre-filled
    - If user is partner but signed in via bespoxai.com → redirect to partners.bespoxai.com with email pre-filled
  - Error message shown: "You tried to sign in to the wrong portal. Please enter your password."
- **Tested & confirmed:** Cross-portal redirects working correctly with email persistence and error messaging

### Admin Endpoint Caching & Indexing (Performance Optimization)
- **Prisma indexes added** (`prisma/schema.prisma`): `@@index([createdAt])` on Tenant, User, PartnerAccount models
  - Deployed via SQL directly in Vercel Postgres dashboard
- **Route caching applied** (60-second revalidation):
  - `app/api/admin/tenants/route.ts`: `unstable_cache` with key `['admin-tenants']`
  - `app/api/admin/users/route.ts`: `unstable_cache` with key `['admin-users']`
  - `app/api/admin/stats/route.ts`: `unstable_cache` with key `['admin-stats']`
  - `app/api/admin/partners/route.ts`: `unstable_cache` with key `['admin-partners']`
- **Admin dashboard optimization** (`app/admin/page.tsx`):
  - Removed duplicate `/api/admin/partners` fetch on tab switch
  - Added `loadPartnerSignups()` method for partner-signups tab only
- **Performance results:** users/stats/partners showed ~90% improvement on cached loads (316ms, 304ms, 380ms)
  - Tenants endpoint still slow (~3.24s) due to complex join query — further optimization deferred
  - Requirements endpoint also slow (~2.91s) — investigation deferred

---

## Session 19 Key Changes — Part 2 (June 7, 2026)

### Partner Portal UX Improvements
- **Removed Agreement link:** Partner portal navigation menu no longer displays "Agreement" link — partners can access agreement through other channels if needed
- **Password change on first sign-in:** New partners now see a modal overlay requiring password change on first sign-in
  - Modal is non-dismissible until password is successfully set
  - Minimum password length: 8 characters
  - Matches customer onboarding UX (Step 0 password change)
  - Uses `mustChangePassword` JWT flag (already set during partner provision)
- **Modal styling:** Consistent with dark theme partner portal (GitHub-like dark colors)

### Login Screen UX Improvements
- **Partner billing placeholder:** Created `/partner/billing` page with "Under Construction" message
- **Password show/hide toggle:** Added eye icon button to login password field (both bespoxai.com/login and partners)
  - Click to toggle between showing/hiding password text
  - Uses emoji icons (👁 show, 👁‍🗨 hide)
  - Only on actual login screens, not other password fields site-wide
  - Improves UX when typing passwords on public/shared machines

### Session 19 Key Changes — Part 1 (June 7, 2026)

### Spec Regeneration Locked After Customer Acceptance
- **Customer portal (RequirementsBuilder):** Regen button ONLY shown in `draft` status
  - Once requirement is submitted (any other status), regen button disappears
  - Spec remains read-only (was already read-only)
- **Admin portal (AdminRequirementsTab):** Regen button hidden when status >= `quoted`
  - Developers can regenerate spec while in pre-quote statuses: draft, submitted, in_review, needs_clarification, quote_rejected
  - Once customer approves quote (status: quoted), spec locks for everyone
- **Partner admin portal (RequirementDetail):** Regen button added with same pre-quote restriction
  - New partner spec generation route: `POST /api/partner/tenants/[id]/requirements/[reqId]/ai-spec`
  - Partners can regenerate spec up until customer acceptance (quoted status)
- **Rationale:** Spec generation happens during discovery/refinement phase. Once customer accepts the quote, spec is final and should not be re-generated (only spec updates should be via addenda)
- **Tested & confirmed:** All portals (customer, admin, partner) working with correct button visibility and API flows

---

## Session 18 Key Changes (June 7, 2026)

### Admin Portal UI Cleanup & Bug Fixes
- **Removed CFO Assistant link:** Superadmin sidebar no longer shows "← CFO Assistant" link — superadmins don't need direct access. Kept the feature flag in AI Setup (controls customer access).
- **Fixed Users table null reference:** Added null check `u.tenant?.name || '—'` to prevent crashes when tenant is null
- **Root cause diagnosed:** Pat Partner (partner@testpartner.com, user role) was created without tenantId
- **Data integrity fixed:** Assigned Pat Partner to TestCo1 via SQL — `UPDATE "User" SET "tenantId" = 'cmpgqbg8l0001tqej9wpqsx6g' WHERE id = 'cx6r5i4m9r18fr5k5gy87z44g'`
- **Commits:** 4 pushes (sidebar link + null check + context files + email flow)

### Partner Email Flow Cleanup
- **Removed redundant email:** `notifySendPartnerAgreement()` no longer sent during partner email verification
- **Rationale:** Modal in UI now handles agreement review; email was redundant
- **New flow:** 
  - Partner signs up → verifies email → superadmins notified (only)
  - Superadmin activates → partner receives activation confirmation + temporary credentials
  - Partner logs in with temp password → forced to set permanent password (`mustChangePassword: true`)
- **Affected route:** `app/api/partner-signup/verify/route.ts` — removed agreement email call

### Notes on User tenantId
- Schema allows `tenantId` to be nullable — users CAN legitimately have null tenant (e.g., superadmins)
- Non-superadmin users must have a tenantId to be functional
- Admin API POST `/api/admin/users` requires tenantId — prevents creating users without tenant
- Should consider data validation to prevent orphaned users (tenant deleted but user remains)

### Previous Session 18 Work (June 6)
- AI-Generated Functional Spec now collapsible in RequirementsBuilder
- Status-dependent defaults + toggle button styled like AdminCardToggleBtn
- BCAgent v3.3

---

## Session 17 Key Changes (June 6, 2026)

### Requirement Assignment System — LIVE
- Schema: `assignedDeveloperId` (non-nullable, defaults to creating user), `assignedAt`, `unableToCompleteAt`
- **Auto-assignment:** Requirements auto-assign to user who creates them
- **Admin reassign:** `/api/requirements/[id]/assign` — PATCH to reassign to another developer
- **Developer mark unable:** `/api/requirements/[id]/mark-unable` — POST to flag requirement as unable to complete
- **Developer filtered view:** Developers see only their assigned requirements in list
- **Assignment modal:** Circular selectors with workload indicators (counts active reqs per dev: light/moderate/heavy)
- **Modal fix:** Proper state management — circles now fill correctly on click, Assign button responsive
- **Notifications:** `notifyRequirementAssigned()` sent to newly assigned dev, `notifyAdminRequirementUnableToComplete()` sent to tenant admins when dev marks unable
- **Affects:** Both BespoxAI and partner portals (same functionality)
- **Tested & confirmed:** Live and working ✅

### Next Priority
- **AI-Generated Functional Spec** section in admin requirement detail to be independently collapsible

---

## Session 8 Key Changes (May 26, 2026)

### RDP End-to-End Test — Confirmed Working (TestCo1)
- RDP via Cloudflare tunnel fully tested and working on TestCo1
- Local machine requires: `cloudflared.exe` from https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
- Connect command: `cloudflared access rdp --hostname {subdomain}-rdp.bespoxai.com --url localhost:3390`
- Then RDP to `localhost:3390` with username `.\BespoxAI-Support` and password from Admin panel copy button

### Bug Fix: SupportAccountPassword Inject (Step 8 was silently skipped)
- **Root cause:** route.ts `.replace()` searched for `[string] $SupportAccountPassword = '',` (with trailing comma) but PS1 has no trailing comma on last param — replace never matched, password stayed empty, Step 8 skipped with "Skipped — no support account password provided"
- **Fix:** Removed trailing comma from both sides of the `.replace()` in `app/api/settings/installer/route.ts`

### Bug Fix: agent.config.json version hardcoded as '2.4'
- **Root cause:** Step 5 of installer had `version = '2.4'` hardcoded — never updated across versions
- **Fix:** Changed to `version = $AgentVersion` — now always reflects current installer version dynamically

### BCAgent Version Bump → 3.2
- `$AgentVersion` and `$Version` in `Install-BespoxAI.ps1` → `'3.2'`
- `AGENT_VERSION` in `app/api/settings/installer/route.ts` → `'3.2'`

### RDP Cleanup Script (for post-testing removal of BespoxAI-Support)
```powershell
net user BespoxAI-Support /delete
net user BespoxAI-Support  # verify gone
```
RDP setting and firewall rule can be left — do not disable RDP as it locks out other admin access.

---

## Session 7 Key Changes (May 26, 2026)

### UAT Status Pipeline
- deploy-test → sets `status: 'in_uat'` on success
- uat-approve → sets `status: 'uat_confirmed'`
- uat-reject → sets `status: 'uat_rejected'`
- STATUS_PIPELINE, STATUS_COLOR, statusLabel updated in RequirementsBuilder + admin
- UAT panel condition driven by status not testDeployedAt
- Null-guard on testDeployedAt date display

### RDP Remote Support (v3.1)
- BCAgent installer Step 8: creates `BespoxAI-Support` local Windows account, adds to Administrators + Remote Desktop Users, enables RDP (port 3389)
- `$SupportAccountPassword` param baked in at installer download, stored as `rdpPassword` in DB
- `lib/cloudflare.ts`: `addRdpIngress()` + `createRdpDnsRecord()` — isolated, existing functions untouched
- `POST /api/admin/provision-rdp`: adds CF ingress + DNS for `{subdomain}-rdp.bespoxai.com`
- Admin tenants table: `[RDP — Tenant Name]` button + `[⧉]` copy password button
- Schema: `rdpPassword String?` added to Tenant
- SQL applied: `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "rdpPassword" TEXT;`

### Back Button Fixes
- Settings tabs: `router.push('/settings?tab=x')` instead of `setTab()` — history entries created
- Settings: `router.replace` to `?tab=overview` on load if no tab param
- Dashboard settings icon: pushes `/settings?tab=overview` (distinct history entry)
- Dashboard nav: `router.replace` → `router.push` for tab changes

### Preferred Name — Site-wide
- `lib/auth.ts`: `firstName` + `preferredName` added to JWT, session, and session refresh
- Rule: `preferredName ?? firstName` only — no fallback to full name
- Dashboard greeting + sidebar, Admin sidebar, Settings sidebar all use preferred name
- `lib/notifications.ts`: `displayName()` helper + `getCustomerEmail` fetches both fields
- CFO assistant answerer: addresses user by `preferredName ?? firstName`
- **Users must log out and back in** for token to pick up new fields

### Installer Filename
- Download button now triggers `Install-BespoxAI-v3.2.zip` (versioned filename)
- Fixed in `app/settings/page.tsx` — `download` attribute was hardcoded

### White Backgrounds
- `--white` CSS variable changed from `#FAFAF8` → `#ffffff` — true white site-wide

### Settings Overview — Production/Test Environment Cards
- Renamed "BC Connection" → "Production Environment Details"
- Removed "System Configuration" card
- Added Product + Last CU fields to Production Environment Details (read-only from DB)
- Removed Agent URL, Status, Member Since from display
- Both cards use consistent grid layout (label above value, font-body text)
- Test env shows all fields with `—` for blanks
- "Leave blank" instruction removed from test env overview (it's read-only)

### Vercel MCP
- Connected Session 7 — Claude can now pull deployment logs directly via Vercel MCP
- Team ID: `team_eZ4MqWjZdsPA2iWoK4exjjPF`
- Project ID: `prj_AT4GXatATIi2FaUCS62Ttp2AivRo`

---

## Database

- **Provider:** PostgreSQL via Vercel Postgres
- **ORM:** Prisma — no migrations, uses `db push` or raw SQL
- **Never run** `prisma migrate`
- **No local clone needed** — Vercel runs `prisma generate` on deploy from schema.prisma in GitHub

### Known Test IDs
- **TestCo1 Tenant ID:** `cmpgqbg8l0001tqej9wpqsx6g` (tunnelSubdomain: testco1, agentPort: 9099)
- **GWM Dev Tenant ID:** `cmoqi33pu0000l3b0zusc5hgz` (tunnelSubdomain: gwmdev — NOT the test tenant)
- **GWM Dev active requirement:** `cmpi4tisk00011422fazu1pxx` (req/cmpi4tis-add-release-date branch)
- **Test Requirement ID:** `cmpdstipk0001tzkg2oq6zlrs`

### Schema Changes — Session 23
```sql
ALTER TABLE "PartnerAccount" ADD COLUMN IF NOT EXISTS "partnerTier" TEXT NOT NULL DEFAULT 'self_serve';
ALTER TABLE "PartnerAccount" ADD COLUMN IF NOT EXISTS "partnerTheme" TEXT NOT NULL DEFAULT 'dark';
```
Applied ✅. prisma/schema.prisma updated ✅.
- `partnerTier`: `self_serve` (full in-portal AI tooling) | `referral` (BespoxAI manages requirements; dev routes 403)
- `partnerTheme`: `dark` (original partner palette) | `light` (BespoxAI parchment)

### Schema Changes — Session 7
```sql
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "rdpPassword" TEXT;
```
Applied ✅. prisma/schema.prisma updated ✅.

---

## Settings Page — CRITICAL Input Pattern

**ProdEnvForm and TestEnvForm use refs + defaultValue (not controlled inputs).**

```tsx
// CORRECT — refs pattern
const refs = { field: useRef<HTMLInputElement>(null) }
<input ref={refs.field} defaultValue={initial.field} ... />
const val = refs.field.current?.value || ''

// WRONG — causes reset bug
const [val, setVal] = useState('')
<input value={val} onChange={e => setVal(e.target.value)} ... />
```

---

## BCAgent v3.2 — Architecture

```
Portal (Vercel) → https://{subdomain}-agent.bespoxai.com (Cloudflare tunnel)
  → cloudflared (Windows service, --protocol http2, runs as SYSTEM)
  → localhost:9099 (BCAgent scheduled task, runs as BC user account)
  → localhost:8048/{bcInstance} (BC/NAV OData, NTLM via UseDefaultCredentials)

RDP: https://{subdomain}-rdp.bespoxai.com (separate CF tunnel ingress)
  → localhost:3389 (Windows RDP)
  → BespoxAI-Support account (local admin, RDP enabled by installer Step 8)
```

### RDP Connection (Rich's local machine)
1. Download cloudflared: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
2. Run: `cloudflared access rdp --hostname {subdomain}-rdp.bespoxai.com --url localhost:3390`
3. RDP to `localhost:3390` — username `.\BespoxAI-Support`, password from Admin panel

### Known NAV v14 OData Limitations
- `$orderby=Posting_Date desc` NOT supported on GeneralLedgerEntry, SalesInvoice
- `$filter` on Posting_Date NOT supported on posted documents
- `$apply`, `groupby`, `aggregate()` NOT supported

---

## CFO Assistant Query Pipeline

1. **Router** (jsonMode:true) — classify needsData
2. **Planner** (jsonMode:true) — pick entity + OData params
3. **OData fetch** — via tunnel → BCAgent → BC
4. **Answerer** — formats response, addresses user by preferredName ?? firstName

---

## Customer Onboarding Flow

1. Sign up → select BC or NAV version → verify email
2. Email triggers `notifyAdminsSignupVerified` to superadmins
3. Superadmin activates from Admin → Signups
4. Customer receives temp credentials + welcome email with password change warning
5. Login → onboarding Step 0 (set permanent password) → Step 1-5 (name, product, connection)
6. Settings → BC Installer → Download (auto-creates tunnel first time, generates rdpPassword on first download only)
7. Run installer on Windows server as Administrator (port 9099) — no uninstall needed for reinstall

---

## Brand & Messaging

- **Login tagline:** "Business Central & Microsoft NAV Intelligence Portal"
- **Signup tagline:** "CFO Intelligence for Business Central & Microsoft NAV"
- **Homepage hero:** "Your Business Central. One portal. Complete control."
- **Primary brand line:** "Bespoke AI. Built for the ERP Microsoft left behind."
- **Backgrounds:** White (`#ffffff`) throughout portal — `--white: #ffffff` in globals.css
- **Placeholder color:** `#8a9a8e` (global CSS)

---

## Plans & Pricing

| Plan | Price | AI Tokens/month |
|------|-------|-----------------|
| Free / Trial | Free | 50,000 |
| Starter | $59/mo | 50,000 |
| Assistant | $299/mo | 300,000 |
| Manager | $499/mo | 750,000 |
| Executive | $999/mo | 3,000,000 |
| Specification Review | $249 one-time | — |

---

## AI System — Provider-Agnostic Pattern (CRITICAL)

Never import `@anthropic-ai/sdk` in API routes:

```typescript
const cfg = await getAiConfig()
const apiKey = cfg.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
if (cfg.provider === 'anthropic') {
  fetch('https://api.anthropic.com/v1/messages', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, ...
  })
}
```

---

## Navigation Rules

- **Never** `router.back()` — always explicit `router.push()`
- Settings deep-links: `?tab=installer`, `?tab=overview`, `?tab=users`, `?tab=entities`
- Settings always has tab in URL — `router.replace('/settings?tab=overview')` on load if none
- Dashboard: `?view=xxx` — uses `router.push` (not replace) for back button support
- Unconnected users → default to `customisations` tab
- Back button works correctly across: Settings tabs, Dashboard nav, Admin tabs
