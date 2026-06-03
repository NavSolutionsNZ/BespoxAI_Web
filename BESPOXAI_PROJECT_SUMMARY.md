# BespoxAI Web Portal — Project Summary

**Project Owner:** Rich Lancaster (richard.lancaster — Windows/MINGW64 environment)
**Current Status:** Full Next.js application deployed to Vercel. Live at bespoxai.com.
**Repository:** NavSolutionsNZ/BespoxAI_Web (GitHub) — renamed from BespokeAI_Web
**Hosting:** Vercel (auto-deploys on push to main)
**Created:** April 2026
**Last Updated:** June 4, 2026 (Session 12)

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

## Session 9 Key Changes (May 26, 2026)

### Manual Deployment Pipeline
- New: `POST /api/requirements/[id]/manual-deploy-test` — sets `in_uat`, appends deployment note, sends UAT notification, skips BCAgent
- New: `POST /api/requirements/[id]/manual-deploy-prod` — sets `prodDeployedAt`, appends note, notifies customer
- `schema.prisma`: `deploymentNotes String? @db.Text` added to Requirement
- Admin deploy-to-test panel: "Mark as manually deployed" checkbox skips Steps 1 & 2
- Admin deploy-to-prod panel: checkbox on Step 2
- Deployment notes displayed superadmin-only below respective deploy buttons

### UAT Customer Notification
- `lib/notifications.ts`: `notifyCustomerReadyForUAT` added
- Fires on successful automated deploy-to-test (debug + real paths)
- Fires on manual deploy-to-test confirm

### Pipeline Dates — All Stages
- `schema.prisma`: 6 new date fields stamped on transitions:
  `submittedAt`, `inReviewAt`, `quotedAt`, `depositRequiredAt`, `inDevelopmentAt`, `completePendingPaymentAt`
- Also using: `depositPaidAt`, `balancePaidAt`, `testDeployedAt`, `uatApprovedAt`, `createdAt`
- Pipeline graphic in customer RequirementsBuilder shows dates under every node
- Pipeline graphic in admin requirement detail also shows all dates
- `requirements/[id]/route.ts` stamps all 6 new dates on status transitions

### Collapsible Cards (Admin only — customer deferred)
- `app/admin/page.tsx`: AI Spec, Q&A Log, Description cards are collapsible
- ▴/▾ arrow toggle, start expanded
- `AdminCardToggleBtn` standalone component extracted before `AdminRequirementsTab`
- **Customer-facing collapsible cards in RequirementsBuilder.tsx deferred** — SWC/JSX parser constraint with this file's deep nesting + `} as const` pattern prevents adding wrapping divs in the current file structure. Needs a clean session approach (possibly extract the spec card section into a separate component file).

### GST — "excl. GST" → "plus GST" Site-wide
- `RequirementsBuilder.tsx` (19), `app/billing/page.tsx` (3), `components/UpgradePrompt.tsx` (1), `lib/notifications.ts` (3)

### SQL Run This Session
```sql
ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "deploymentNotes" TEXT;
ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP;
ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "inReviewAt" TIMESTAMP;
ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "quotedAt" TIMESTAMP;
ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "depositRequiredAt" TIMESTAMP;
ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "inDevelopmentAt" TIMESTAMP;
ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "completePendingPaymentAt" TIMESTAMP;
```
All applied ✅

---

## Session 11 Key Changes (June 4, 2026)

### Partner Programme — Phase 2

#### Schema
- `User.tenantId` made nullable (`String?`, `tenant Tenant?`) — partner users have no tenant
- SQL applied: `ALTER TABLE "User" ALTER COLUMN "tenantId" DROP NOT NULL;`
- `prisma/schema.prisma` updated

#### Partner User Activation Fix
- `app/api/admin/partners/[id]/activate/route.ts`: removed placeholder tenant hack, now sets `tenantId: null`

#### Requirements Guard
- `app/api/requirements/route.ts`: POST now returns 403 if `user.tenantId` is null (partner users cannot create requirements via the standard route)

#### Null-guard Fix
- `app/api/migration/enquiry/route.ts`: `user.tenant?.name` — was crashing after tenantId nullable change

#### Partner Tenant View (`/partner/tenants/[id]`)
- 4-tab client management view: Overview, Requirements, Users, Settings
- Requirements tab: full pipeline — list, raise, submit, Q&A, quote accept/reject (no Stripe payment, no BCAgent panels)
- Settings tab: read-only BC config with "contact support" note

#### New API Routes
- `GET /api/partner/tenants/[id]` — single tenant + users
- `GET/POST /api/partner/tenants/[id]/requirements` — list + raise on behalf
- `GET/PATCH /api/partner/tenants/[id]/requirements/[reqId]` — detail + customer-side actions

#### Add Client (`/partner/tenants/new`)
- Full-page form: company name, subdomain (auto-generated on blur), product toggle (BC/NAV), version, last CU
- Production environment: BC instance, company, SQL server, database, server instance, OData port, agent port, management port
- BC service account: username (stored in DB) + password (never stored — baked into installer at download, same as existing customer flow)
- Test environment: collapsible section, all test env fields
- `POST /api/partner/tenants`: creates tenant record with `partnerAccountId` from session, no tunnel — auto-provisioned on first installer download
- Subdomain uniqueness checked at create time (409 if taken)

### Test Data (seed SQL delivered this session)
- Partner account: "Test Partner Ltd" (slug: testpartner)
- Partner login: `partner@testpartner.com` / `Partner123!`
- Two seed tenants: Acme Distribution Ltd (acmedist, BC25) + Pinnacle Manufacturing NZ (pinnaclemfg, NAV12)
- Three seed requirements across both tenants (submitted, in_development, draft)

---

## Session 10 Key Changes (June 4, 2026)

### Partner Programme — Phase 1 Complete
- **DB/Schema:** PartnerAccount, PartnerUser, PartnerSignupRequest tables live
- **lib/crypto.ts** — AES-256-GCM encrypt/decrypt (`PARTNER_GITHUB_TOKEN_ENCRYPTION_KEY` env var, 64 hex chars)
- **lib/branding.ts** — BrandingConfig + DEFAULT_BRANDING + resolveBranding() — Phase 4 ready
- **lib/partner-auth.ts** — requirePartnerSession() + assertTenantBelongsToPartner()
- **lib/auth.ts** — partner context in JWT/session; login redirects to /partner/dashboard
- **middleware.ts** — partners.bespoxai.com rewrites to /partner-site/*
- **Partner portal** — dark GitHub-style sidebar layout + dashboard with tenant table
- **Partner self-serve signup** — partners.bespoxai.com landing + form (company/contact/GST/address/phone/payment mode/bank account) + verify flow
- **Superadmin Partners tab** — create/edit partner accounts, pending applications + Activate button, partner pill on tenant rows
- **partners.bespoxai.com** — Cloudflare CNAME + Vercel Production domain configured

### PartnerAccount key fields
paymentMode: 'bespoxai_collected' | 'partner_collected'
agentBrandName: replaces 'BespoxAI' in agent paths/filenames (wired Phase 4, stored now)
bankAccount: for revenue share payouts (masked in UI)
githubToken: AES-256-GCM encrypted
revenueSharePartner: default 0.60

### Partner payment modes
- bespoxai_collected: standard Stripe (Phase 3); approval buttons labelled "Approve & Begin Development" / "Approve & Release to Client" with "This will be invoiced to your BespoxAI account"
- partner_collected: partner bills clients directly; BespoxAI invoices partner for revenue share

### Known schema debt
User.tenantId is required FK; partner users get placeholder tenantId on activation. Make nullable in Phase 2.

## Session 12 Key Changes (June 4, 2026)

### Partner Programme — Phase 2 BCAgent + Client UX
- **Partner BCAgent routes** — `POST /api/partner/tenants/[id]/installer`, `sync-config`, `provision-rdp`
  - All scoped behind `requirePartnerSession('partner_admin')` + `assertTenantBelongsToPartner()`
  - Installer auto-provisions Cloudflare tunnel on first download, generates rdpPassword
  - Tunnel provision clears `connectionRequestedAt/ToEmail` on the Tenant
- **BCAgent tab** in `/partner/tenants/[id]` — full Production + Test env form (editable, refs pattern),
  Sync Config + Provision RDP buttons (conditional on `tunnelId`), Download Installer button
- **`managedByPartner`** flag added to JWT/session for regular tenant users whose tenant has a `partnerAccountId`
- **Client user settings** — BC Installer tab hidden for partner-managed users; URL redirect guard added
- **Dashboard** — partner-managed clients: Upgrade/Billing sidebar hidden, installer setup prompt replaced
  with neutral "not yet connected" box, CFO greeting updated
- **Request Connection / Request Upgrade buttons** — `POST /api/partner/request`, `GET /api/partner/request-state`
  - Sends email to partner `billingEmail` + all BespoxAI superadmins
  - Persists to Tenant: `connectionRequestedAt`, `connectionRequestedToEmail`, `upgradeRequestedAt`, `upgradeRequestedToEmail`
  - No re-request once submitted; connection request cleared when tunnel is provisioned
  - Dashboard loads persisted state on mount, shows "Requested [date] — sent to [email]" instead of button

### Schema changes — Session 12
```sql
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "connectionRequestedAt"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "connectionRequestedToEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "upgradeRequestedAt"         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "upgradeRequestedToEmail"    TEXT;
```
Applied ✅. prisma/schema.prisma updated ✅.

### Interactive question widget pattern
- Always use sequential single-question widgets (one question at a time, `innerHTML` re-render on answer)
- Never use hidden elements (`display:none`) in widgets — they fail to render during iframe streaming
- Outer container must have `min-height` set to prevent iframe collapse
- Use inline `onclick` handlers, not `addEventListener` (runs after streaming)

### Test seed data
- Partner: Test Partner Ltd (slug: testpartner), login: partner@testpartner.com / Partner123!
- Client tenants: Acme Distribution Ltd (acmedist, BC25), Pinnacle Manufacturing NZ (pinnaclemfg, NAV12)
- Test client user: client@acmedist.com / password (tenant_admin on Acme, managedByPartner=true)

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
- **GST:** All prices show "plus GST" (not "excl. GST") — changed session 9

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
