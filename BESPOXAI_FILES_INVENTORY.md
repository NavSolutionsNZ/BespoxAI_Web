# BespoxAI Web Portal — Files & Structure Inventory

**Last Updated:** May 23, 2026 (Session 3)

---

## ⚠️ Architecture Notes

- Live product at bespoxai.com is a full **Next.js application**
- **`public/index.html`** is the LIVE homepage — not root `index.html` (that is outdated)
- AI provider is **Anthropic Claude** (configurable via admin UI — no redeploy needed)
- BCAgent v2.4 — PowerShell HttpListener service, full deployment workflow
- GitHub per-customer repos — `lib/github.ts`, classic PAT stored as `GITHUB_CUSTOMER_REPOS_TOKEN`
- Default agent port is **9099** (was 8080 — changed Session 3)

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
| `app/globals.css` | Global CSS variables and base styles. Body background: `#ffffff`. Placeholder color: `#8a9a8e`. |
| `app/dashboard/page.tsx` | Main portal. `?view=xxx` URL param persists nav tab. Back button → `router.push('/dashboard')`. Unconnected users default to `customisations` tab. |
| `app/billing/page.tsx` | Subscription management. Back button → `router.push('/dashboard')`. |
| `app/admin/page.tsx` | Superadmin portal — 8 tabs. URL syncs selected requirement as `?tab=requirements&req={id}`. Users/entities tables: no maxWidth cap. Signups tab: hides activated accounts, has delete button. Provision flow: creates tunnel + tenant + user with temp password. |
| `app/login/page.tsx` | Login. White background, no grid/orb. Tagline: "Business Central & Microsoft NAV Intelligence Portal". Request access link top-right. |
| `app/signup/page.tsx` | Signup. BC + NAV version dropdown with optgroups. Tagline: "CFO Intelligence for Business Central & Microsoft NAV". |
| `app/signup/verify/page.tsx` | Email verification. useEffect calls `/api/signup/verify?token=` on load. Sends `notifyAdminsSignupVerified` on success. Branded header with tagline. |
| `app/onboarding/page.tsx` | Post-signup onboarding. Step 1: firstName, lastName, preferredName + persona. Step 4: full BC connection fields. Step 5: "Open BC Installer →" button if wantsToConnect. No nav links (prevent escape). |
| `app/settings/page.tsx` | Customer settings. Wrapped in Suspense for useSearchParams. `?tab=installer` deep-links to BC Installer tab. Overview: Your Profile card (firstName/lastName/preferredName). BC Installer: all forms use **refs + defaultValue** (NOT controlled inputs) — this was the fix for the input reset bug. TestEnvForm and ProdEnvForm both use refs. Back button → `router.push('/dashboard')`. |

### API Routes (`/app/api`)

| Route | Purpose |
|-------|---------|
| `api/query/route.ts` | CFO Assistant |
| `api/requirements/route.ts` | List/create requirements |
| `api/requirements/[id]/route.ts` | GET/update/delete |
| `api/requirements/[id]/ai-spec/route.ts` | Spec gen |
| `api/requirements/[id]/feasibility/route.ts` | Feasibility |
| `api/requirements/[id]/dev-notes/route.ts` | Dev assistant streaming |
| `api/requirements/[id]/dev-plan/route.ts` | Dev plan |
| `api/requirements/[id]/coding-assistant/route.ts` | Loads C/AL from GitHub branch |
| `api/requirements/[id]/coding-assistant/commit/route.ts` | Commits C/AL back to branch |
| `api/requirements/[id]/addendum/route.ts` | Creates child requirement |
| `api/requirements/[id]/prod-approval/route.ts` | AI generates go-live doc |
| `api/requirements/[id]/prod-approve/route.ts` | Customer approves go-live |
| `api/requirements/[id]/objects/route.ts` | GET + POST JSON upsert |
| `api/requirements/[id]/objects/deploy-test/route.ts` | Deploy to test env |
| `api/requirements/[id]/objects/deploy-prod/route.ts` | BCAgent prod deploy |
| `api/requirements/[id]/uat-approve/route.ts` | UAT sign-off |
| `api/requirements/[id]/uat-reject/route.ts` | AI scope-creep check |
| `api/requirements/[id]/pay-deposit/route.ts` | Deposit checkout |
| `api/requirements/[id]/pay-balance/route.ts` | Balance checkout |
| `api/settings/route.ts` | GET/PATCH tenant |
| `api/settings/installer/route.ts` | POST — **auto-provisions Cloudflare tunnel on first download** if no tunnelId. Generates BCAgent installer zip. |
| `api/settings/profile/route.ts` | GET/PATCH user firstName/lastName/preferredName |
| `api/settings/users/route.ts` | GET + POST invite |
| `api/settings/users/[id]/route.ts` | PATCH + DELETE. DELETE also removes associated SignupRequest. |
| `api/admin/signups/route.ts` | Lists unactivated signup requests only (activatedAt: null) |
| `api/admin/signups/[id]/route.ts` | DELETE signup request |
| `api/admin/signups/[id]/activate/route.ts` | Activates account. Sets user name to null (not company name). |
| `api/admin/signups/[id]/verify/route.ts` | Force verify |
| `api/admin/provision/route.ts` | Provision new tenant. Creates tunnel + tenant + user (if customerEmail provided). agentPort default: 9099. |
| `api/admin/requirements/route.ts` | Admin requirements list |
| `api/admin/ai-config/route.ts` | GET/POST AI config |
| `api/admin/users/[id]/route.ts` | PATCH + DELETE. DELETE also removes SignupRequest. |
| `api/billing/create-checkout/route.ts` | Stripe subscription checkout |
| `api/onboarding/route.ts` | GET/POST onboarding data. Saves firstName/lastName/preferredName/userName. BC_VERSION_MAP includes all BC+NAV versions. |
| `api/signup/verify/route.ts` | Verifies token, fires notifyAdminsSignupVerified |
| `api/webhooks/stripe/route.ts` | Stripe webhook |

### Components (`/components`)

| File | Purpose |
|------|---------|
| `RequirementsBuilder.tsx` | Full customer flow. URL sync, renderMdLight, Documents section. |
| `SuperAdminDashboard.tsx` | Admin overview KPIs. |
| `BillingCharts` (inside SuperAdminDashboard.tsx) | Extracted sub-component — do NOT merge back. |

### Lib Files (`/lib`)

| File | Purpose |
|------|---------|
| `notifications.ts` | All lifecycle emails. Includes: `notifyAdminsSignupVerified`, `notifyCustomerProdApproval`, `notifyAdminsProdApproved`, `notifyCustomerProdDeployed` |
| `cloudflare.ts` | `createTunnel()`, `configureTunnelIngress()`, `createDnsRecord()`, `getTunnelToken()` |
| `tenant-context.ts` | `buildTenantContext()` |
| `github.ts` | Per-customer GitHub repos |
| `ai-config.ts` | `getAiConfig()` |

### Scripts (`/scripts`)

| File | Purpose |
|------|---------|
| `Install-BespoxAI.ps1` | BCAgent v2.4 installer. Default port: **9099**. Pure ASCII. |
| `Uninstall-BespoxAI.ps1` | Full cleanup script. Default port: **9099**. Removes scheduled task, cloudflared service, files. Handles HTTP.sys via netsh. Never kills PID 4. |

---

## Database Schema — Key Models

### User
```
name          String?   -- full display name (kept for compat)
firstName     String?   -- NEW Session 3
lastName      String?   -- NEW Session 3
preferredName String?   -- NEW Session 3 — address by this if set, else firstName
role: "superadmin" | "tenant_admin" | "user" | "developer"
```

### Requirement
```
status: draft | submitted | needs_clarification | in_review | quoted | quote_rejected |
        deposit_required | deposit_paid | in_development | complete_pending_payment |
        fully_paid | rejected

-- Deployment & UAT
testDeploySnapshotId, testDeployedAt, uatApprovedAt, uatRejectedAt

-- Production deployment
prodApprovalSentAt, prodGoLiveDoc, prodApprovedAt, prodApprovedById, prodDeployedAt, prodDeploySnapshotId

-- GitHub & Developer
githubBranch, assignedDeveloperId

-- Addenda
parentId, addenda
```

### Tenant
```
tunnelId           String?  -- Cloudflare tunnel ID (auto-created on first installer download)
tunnelSubdomain    String?  -- e.g. "acmemotors" → acmemotors-agent.bespoxai.com
bcPort             Int      -- default 8048
agentPort          Int      -- default 9099 (was 8080)
navDatabaseName    String?  -- required for C/AL object export
navDatabaseServer  String?
navServerInstance  String?
bcInstance         String?
bcCompany          String?
testNavDatabaseName   String?  -- test env (same-server setup)
testBcInstance        String?
testBcCompany         String?
stripeCustomerId   String?
```

### SignupRequest
```
-- Activated accounts are filtered from the admin signups list
-- Deleted when associated User is deleted
```

---

## Settings Page — Input Pattern (CRITICAL)

**All form inputs in settings/page.tsx use refs + defaultValue, NOT controlled inputs.**

This was the fix for a persistent input-reset bug where values disappeared mid-typing.

Pattern used throughout:
```tsx
const refs = { fieldName: useRef<HTMLInputElement>(null) }
// ...
<input ref={refs.fieldName} defaultValue={initial.fieldName} ... />
// On save:
const val = refs.fieldName.current?.value || ''
```

**Never use `value={state} onChange={...}` in settings page inputs.** Use refs.

---

## Customer Activation Flow (Session 3)

1. Customer signs up at `/signup` — selects BC or NAV version
2. Verifies email — `notifyAdminsSignupVerified` fires to superadmins
3. Superadmin activates from Admin → Signups tab
4. Customer receives email with temp credentials
5. Customer logs in → redirected to onboarding
6. Onboarding step 1: name fields (firstName, lastName, preferredName) + persona
7. Onboarding step 4: BC connection details (instance, company, DB name, ports)
8. After onboarding: dashboard shows connection banner if not connected
9. Settings → BC Installer tab: fill credentials → Download
10. **First download auto-provisions Cloudflare tunnel** (no separate admin step)
11. Run installer on Windows server as Administrator (port 9099)

---

## BCAgent Defaults (Session 3 Changes)
- Default port: **9099** (changed from 8080 everywhere)
- Version: **2.4**
- Installer: `Install-BespoxAI.ps1` — pure ASCII, no UTF-8 special chars
- Uninstaller: `Uninstall-BespoxAI.ps1` — same

---

## Navigation Rules
- Never use `router.back()` — always explicit `router.push()`
- Back buttons: Settings/Billing → `/dashboard`, Admin sidebar → `/dashboard`
- Settings deep-links: `?tab=installer`, `?tab=overview`, `?tab=users`, `?tab=entities`
- Dashboard `?view=xxx` persists nav tab
- Unconnected dashboard users default to `customisations` tab

---

## Dashboard — Not-Connected Banner
Shows when `health.status === 'error'` and no BC connection. Contains:
- 3-step guide with clickable "Settings → BC Installer" link
- "Go to BC Installer →" button → `/settings?tab=installer`
- "Customisations" link → `setActiveNav('customisations')`

---

## Greeting Logic (Session 3)
```ts
const displayFirst = user?.preferredName || user?.firstName || 
                     user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there'
```

---

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
- ❌ Don't merge BillingCharts back into SuperAdminDashboard — it's extracted for SWC
- ❌ Don't use Python heredocs for fix scripts — write to `/tmp/fix_xxx.py` files
- ❌ Don't use `str_replace` with strings that appear more than once — use Python `content.replace(..., 1)`
- ❌ Don't push without checking imports — TypeScript errors from missing imports waste deploy cycles
- ❌ Don't import `@anthropic-ai/sdk` in API routes — use provider-agnostic fetch pattern
- ❌ Don't use `router.back()` anywhere — always use explicit `router.push()`
- ❌ Don't use controlled inputs (`value/onChange`) in settings page — use refs + defaultValue
- ❌ Don't default agent port to 8080 anywhere — it's 9099
