# BespoxAI Web Portal — Files & Structure Inventory

**Last Updated:** May 25, 2026 (Session 6)

---

## ⚠️ Architecture Notes

- Live product at bespoxai.com is a full **Next.js application**
- **`public/index.html`** is the LIVE homepage
- AI provider is configurable via admin UI (OpenAI gpt-4o currently active for TestCo1)
- BCAgent v2.9 — PowerShell HttpListener service, full deployment workflow
- C/AL export uses **finsql.exe directly** (not Export-NAVApplicationObject — removed in BC14)
- finsql found via wildcard path search (BC14 paths first, then legacy NAV)
- finsql writes ANSI/ASCII — read with Get-Content -Raw (not ReadAllBytes+Unicode decode)
- Objects grouped by type for finsql (one launch per type, e.g. Type=Table;ID=27|37)
- finsql needs id=BespoxAI to avoid ZUP file conflicts on multi-instance servers
- SQL server address for finsql comes from navDatabaseServer in agent.config.json (NOT localhost)
- GWM_Dev DB server: 10.24.244.19 (read from CustomSettings.config)
- NavModelTools.ps1 location: C:\Program Files (x86)\Microsoft Dynamics 365 Business Central\140\RoleTailored Client\
- GitHub per-customer repos — `lib/github.ts`, classic PAT stored as `GITHUB_CUSTOMER_REPOS_TOKEN`
- Default agent port is **9099**
- **Version bumped on every push** — two places: `$AgentVersion`/`$Version` in Install-BespoxAI.ps1, `AGENT_VERSION` in installer/route.ts. Will reset at go-live.

---

## GitHub Repository

- **Org/Repo:** `NavSolutionsNZ/BespokeAI_Web`
- **Branch:** `main`
- **Sparse checkout (preferred):** fetch only files needed per task
- **Push command:** `git push origin master:main`

### Sparse Checkout Setup (every session)
```bash
cd /home/claude
git init repo && cd repo
git remote add origin https://{TOKEN}@github.com/NavSolutionsNZ/BespokeAI_Web.git
git sparse-checkout init
git sparse-checkout set --no-cone "app" "components" "lib" "scripts" "prisma"
git pull origin main
git config user.email "claude@anthropic.com" && git config user.name "Claude"
```
Note: include `"prisma"` — schema.prisma is now actively maintained.

---

## Production File Map

### App Pages (`/app`)

| File | Purpose |
|------|---------|
| `app/page.tsx` | Root/home page |
| `app/layout.tsx` | Root layout, fonts, session provider |
| `app/globals.css` | Global CSS. Body background: `#ffffff`. Placeholder: `#8a9a8e`. |
| `app/dashboard/page.tsx` | Main portal. Mobile: slide-over sidebar. Unconnected → `customisations` tab. |
| `app/billing/page.tsx` | Subscription management. Back → `router.push('/dashboard')`. Mobile responsive. |
| `app/admin/page.tsx` | Superadmin portal — 8 tabs. Mobile: slide-over sidebar. ConnectedPill for tenant status. |
| `app/login/page.tsx` | Login. White background. Corner links at 20px for mobile. |
| `app/signup/page.tsx` | Signup. BC + NAV version dropdown with optgroups. Card padding uses clamp(). |
| `app/signup/verify/page.tsx` | Email verification. useEffect calls API on load. Sends notifyAdminsSignupVerified. |
| `app/onboarding/page.tsx` | Post-signup onboarding. Step 0: force password change. Sidebar hidden on mobile. |
| `app/settings/page.tsx` | Customer settings. ProdEnvForm + TestEnvForm sub-components. Mobile: sticky top nav. ChangePasswordCard. agentVersion fetched from GET /api/settings/installer and shown on Download button. |

### API Routes (`/app/api`)

| Route | Purpose |
|-------|---------|
| `api/query/route.ts` | CFO Assistant. Router + planner use jsonMode:true. Bad query steering via QueryLog. |
| `api/requirements/route.ts` | List/create requirements |
| `api/requirements/[id]/route.ts` | GET/update/delete |
| `api/requirements/[id]/ai-spec/route.ts` | Spec gen |
| `api/requirements/[id]/feasibility/route.ts` | Feasibility |
| `api/requirements/[id]/dev-notes/route.ts` | Dev assistant streaming |
| `api/requirements/[id]/dev-plan/route.ts` | Dev plan |
| `api/requirements/[id]/coding-assistant/route.ts` | Loads C/AL from GitHub branch |
| `api/requirements/[id]/coding-assistant/commit/route.ts` | Commits C/AL back to branch |
| `api/requirements/[id]/prod-approval/route.ts` | AI generates go-live doc |
| `api/requirements/[id]/prod-approve/route.ts` | Customer approves go-live |
| `api/requirements/[id]/objects/route.ts` | GET + POST JSON upsert |
| `api/requirements/[id]/objects/write/route.ts` | Writes object files to BCAgent deployment folder. Saves snapshotId to DB. |
| `api/requirements/[id]/objects/sync-from-github/route.ts` | Pulls latest files from GitHub branch into TenantObjectFile DB. |
| `api/requirements/[id]/objects/deploy-test/route.ts` | Deploy to test env. Hardened: try-catch fetch, text-first JSON parse. |
| `api/requirements/[id]/objects/deploy-prod/route.ts` | BCAgent prod deploy. Same hardening as deploy-test. |
| `api/requirements/[id]/uat-approve/route.ts` | UAT sign-off |
| `api/requirements/[id]/uat-reject/route.ts` | AI scope-creep check |
| `api/settings/route.ts` | GET/PATCH tenant. Includes navManagementPort + testNavManagementPort. |
| `api/settings/installer/route.ts` | GET returns `{ version: AGENT_VERSION }`. POST generates installer zip using tenant DB values directly for all PS1 replace calls. Does NOT save test env fields (managed by settings PATCH only). |
| `api/settings/sync-config/route.ts` | POST — reads all tenant fields from DB, POSTs to BCAgent /bespoxai/update-config. |
| `api/settings/profile/route.ts` | GET/PATCH user firstName/lastName/preferredName |
| `api/settings/profile/change-password/route.ts` | POST — change password. clearMustChange=true skips current password check. |
| `api/settings/users/route.ts` | GET + POST invite. Sends notifyUserWelcome. mustChangePassword=true on create. |
| `api/settings/users/[id]/route.ts` | PATCH + DELETE. DELETE also removes SignupRequest. |
| `api/admin/signups/route.ts` | Lists unactivated signup requests only |
| `api/admin/provision/route.ts` | Provision new tenant. agentPort default: 9099. mustChangePassword=true. Sends notifyUserWelcome. |
| `api/admin/ai-config/route.ts` | GET/POST AI config |
| `api/admin/users/[id]/route.ts` | PATCH + DELETE. DELETE also removes SignupRequest. |
| `api/billing/create-checkout/route.ts` | Stripe subscription checkout |
| `api/onboarding/route.ts` | GET/POST onboarding data. |
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
| `notifications.ts` | All lifecycle emails. notifyUserWelcome (welcome + temp password). notifyAdminsSignupVerified etc. |
| `cloudflare.ts` | `createTunnel()`, `configureTunnelIngress()`, `createDnsRecord()`, `getTunnelToken()` |
| `tenant-context.ts` | `buildTenantContext()` |
| `tenants.ts` | `getTenantById()`, `buildODataUrl()`. agentPort fallback: 9099. |
| `github.ts` | Per-customer GitHub repos. `listFiles()`, `getFile()`, `pushObjectsToGitHub()`. |
| `ai-config.ts` | `getAiConfig()` |
| `auth.ts` | NextAuth config. JWT includes: tenantId, role, onboardingDone, mustChangePassword, navProduct, persona. |

### Scripts (`/scripts`)

| File | Purpose |
|------|---------|
| `Install-BespoxAI.ps1` | BCAgent v2.9 installer. Full deploy pipeline, sync config endpoint, all env fields baked in. |
| `Uninstall-BespoxAI.ps1` | Full cleanup. Removes registry key, cloudflared service, files. |
| `Uninstall-BespoxAI.bat` | Right-click Run as Administrator shim for the PS1. Manually distributed. |

---

## Database Schema — Key Models

### User
```
name               String?
firstName          String?
lastName           String?
preferredName      String?   -- address by this if set, else firstName
mustChangePassword Boolean   @default(false)
role: "superadmin" | "tenant_admin" | "user" | "developer"
```
All in prisma/schema.prisma ✅

### Tenant (key fields)
```
tunnelId              String?
tunnelSubdomain       String?  -- e.g. "gwmdev" → gwmdev-agent.bespoxai.com
bcPort                Int      -- default 8048
agentPort             Int      -- default 9099
navDatabaseServer     String?
navDatabaseName       String?
navServerInstance     String?
navManagementPort     Int?     @default(7045)  -- production NAV mgmt port for schema sync
bcInstance            String?
bcCompany             String?
testNavDatabaseServer String?
testNavDatabaseName   String?
testNavServerInstance String?
testNavManagementPort Int?     @default(7045)  -- test NAV mgmt port for schema sync
testBcInstance        String?  -- used as fallback for testNavServerInstance in compile
testBcCompany         String?
testBcPort            Int?
```
All in prisma/schema.prisma ✅

### Known Tenants
| ID | Name | tunnelSubdomain | agentPort |
|----|------|-----------------|-----------|
| cmpgqbg8l0001tqej9wpqsx6g | TestCo1 | testco1 | 9099 |
| cmoqi33pu0000l3b0zusc5hgz | GWM Dev | gwmdev | 8080 |
| cmoqtoiyv0000f8pfhcpdfqyo | GWM2_AutoInstall | gwm2 | 8080 |
| cmoInpd4v0001bf6xftw1v8h0 | Test Comp 1 | testcomp1 | 8080 |

### Schema Changes — Session 6 (all applied to Vercel Postgres ✅)
```sql
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "testNavManagementPort" INTEGER NOT NULL DEFAULT 7045;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "navManagementPort" INTEGER NOT NULL DEFAULT 7045;
```
prisma/schema.prisma updated for both + mustChangePassword ✅

---

## BCAgent v2.9 — Critical Implementation Notes

### Version — TWO places, bump every push
1. `$AgentVersion = '2.9'` and `$Version = '2.9'` in `Install-BespoxAI.ps1`
2. `const AGENT_VERSION = '2.9'` in `app/api/settings/installer/route.ts`

### Installer Banner
Shows all production AND test env fields at startup for customer verification.

### Reinstall — No Uninstall Needed
1. Stop BespoxAI-BCAgent scheduled task (regardless of state)
2. Use `netstat -ano` to find PID on port
3. Check `Win32_Process.CommandLine` contains `BCAgent.ps1` before killing
4. Wait up to 5s for port to free
5. Warn only if port still in use by non-BCAgent process

### Sync Config to Agent
- **UI:** "↑ Sync Config to Agent" button in Settings → BC Installer tab (disabled until tunnel provisioned)
- **API:** POST /api/settings/sync-config
- **BCAgent endpoint:** POST /bespoxai/update-config — writes agent.config.json + updates in-memory vars immediately
- **Log:** Shows only changed fields (field: old → new)
- Does NOT sync bcPassword/bcUsername (not in DB)

### agent.config.json — Full Field List
```
apiKey, listenPort, bcBaseUrl (includes instance e.g. http://localhost:8048/GWM_Dev),
bcPort, agentPort, bcUsername, bcPassword, bcInstance, bcCompany,
navDatabaseServer, navDatabaseName, navServerInstance, navManagementPort,
testNavDatabaseServer, testNavDatabaseName, testNavServerInstance, testNavManagementPort,
testBcInstance, testBcCompany, testBcPort, version
```

### Deploy — Import + Compile
- `$NavIde` set from finsql.exe wildcard search before NavModelTools.ps1 dot-sourced
- `Import-NAVApplicationObject` uses `-Confirm:$false`
- `Compile-NAVApplicationObject` uses `-NavServerName localhost -NavServerInstance $dbInst -NavServerManagementPort $mgmtPort`
- `$mgmtPort` = `$NavMgmtPort` (prod) or `$TestNavMgmtPort` (test)
- `$dbInst` for test: `$TestNavServerInst` if set, else falls back to `$TestBcInstance`
- Production compile has same config checks as test — fails clearly if not configured
- Response writes wrapped in try-catch for dropped connections

### Deploy Pipeline Flow
```
Admin UI → Sync from GitHub → DB
         → Write files to BCAgent server
         → Deploy + Compile to Test  ✅ WORKING (Session 6)
         → Deploy + Compile to Production  (code ready, not yet tested)
```

### BCAgent Architecture
```
Portal (Vercel) → https://{subdomain}-agent.bespoxai.com (Cloudflare tunnel)
  → cloudflared (Windows service, --protocol http2, runs as SYSTEM)
  → localhost:9099 (BCAgent scheduled task, runs as BC user account)
  → localhost:8048/{bcInstance} (BC/NAV OData, NTLM via UseDefaultCredentials)
```

### Known NAV v14 OData Limitations
- `$orderby=Posting_Date desc` NOT supported on GeneralLedgerEntry, SalesInvoice
- `$filter` on Posting_Date NOT supported on posted documents
- `$apply`, `groupby`, `aggregate()` NOT supported

---

## Settings Page — Input Pattern (CRITICAL)

**ProdEnvForm and TestEnvForm use refs + defaultValue (not controlled inputs).**

```tsx
const refs = { fieldName: useRef<HTMLInputElement>(null) }
<input ref={refs.fieldName} defaultValue={initial.fieldName} ... />
const val = refs.fieldName.current?.value || ''
```

**Installer route uses tenant DB values directly** for all PS1 replace calls — never uses body values for config fields. Test env fields are managed exclusively by settings PATCH route.

---

## CFO Assistant — Query Pipeline

```
POST /api/query
  → Router (jsonMode:true) → needsData true/false
  → Planner (jsonMode:true) → entity + OData params
  → OData fetch via BCAgent tunnel
  → Answerer → structured response
  → QueryLog (tenantId, userId, question, answer, entity, displayHint, recordCount)
```

---

## Navigation Rules
- Never use `router.back()` — always explicit `router.push()`
- Back buttons: Settings/Billing → `/dashboard`
- Settings deep-links: `?tab=installer`, `?tab=overview`, `?tab=users`, `?tab=entities`
- Dashboard `?view=xxx` persists nav tab
- Unconnected dashboard users default to `customisations` tab

---

## What NOT to Do

- ❌ Don't edit root `index.html` — edit `public/index.html`
- ❌ Don't use `cmoqi33pu0000l3b0zusc5hgz` as the test tenant ID — that's GWM Dev, not TestCo1
- ❌ Don't run `prisma migrate` — use `db push` or raw SQL
- ❌ Don't use `git push origin main` — use `git push origin master:main`
- ❌ Don't use `&&` shortcircuit JSX in large functions — use `cond ? <JSX/> : null`
- ❌ Don't use template literals `${var}` in JSX — use string concatenation
- ❌ Don't merge BillingCharts back into SuperAdminDashboard — it's extracted for SWC
- ❌ Don't use Python heredocs for fix scripts — write to `/tmp/fix_xxx.py` files
- ❌ Don't push without checking imports
- ❌ Don't import `@anthropic-ai/sdk` in API routes
- ❌ Don't use `router.back()` — always explicit `router.push()`
- ❌ Don't use controlled inputs in settings page — use refs + defaultValue
- ❌ Don't default agent port to 8080 — it's 9099
- ❌ Don't run BCAgent as SYSTEM — it must run as the BC user account
- ❌ Don't use HttpClient in BCAgent — use HttpWebRequest (WinHTTP-backed NTLM)
- ❌ Don't push changes without explicit confirmation from Rich
- ❌ Don't assume timeout on deploy errors — ask for BCAgent log first
- ❌ Don't implement significant architectural changes without discussion first
- ❌ Don't save test env fields from installer route DB save — settings PATCH only
- ❌ Don't use body values for installer PS1 replace calls — use tenant DB object directly
- ❌ Don't forget to bump version in BOTH Install-BespoxAI.ps1 AND installer/route.ts on every push
