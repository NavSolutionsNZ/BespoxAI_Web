# BespoxAI Web Portal — Files & Structure Inventory

**Last Updated:** May 26, 2026 (Session 7)

---

## ⚠️ Architecture Notes

- Live product at bespoxai.com is a full **Next.js application**
- **`public/index.html`** is the LIVE homepage
- AI provider is configurable via admin UI (OpenAI gpt-4o currently active for TestCo1)
- BCAgent v3.1 — PowerShell HttpListener service, full deployment workflow
- C/AL export uses **finsql.exe directly** (not Export-NAVApplicationObject — removed in BC14)
- finsql found via wildcard path search (BC14 paths first, then legacy NAV)
- finsql writes ANSI/ASCII — read with Get-Content -Raw (not ReadAllBytes+Unicode decode)
- Objects grouped by type for finsql (one launch per type)
- finsql needs id=BespoxAI to avoid ZUP file conflicts on multi-instance servers
- SQL server address for finsql comes from navDatabaseServer in agent.config.json (NOT localhost)
- GWM_Dev DB server: 10.24.244.19 (read from CustomSettings.config)
- NavModelTools.ps1 location: C:\Program Files (x86)\Microsoft Dynamics 365 Business Central\140\RoleTailored Client\
- GitHub per-customer repos — `lib/github.ts`, classic PAT stored as `GITHUB_CUSTOMER_REPOS_TOKEN`
- Default agent port is **9099**
- **Version bumped on every push** — two places: `$AgentVersion`/`$Version` in Install-BespoxAI.ps1, `AGENT_VERSION` in installer/route.ts

---

## GitHub Repository

- **Org/Repo:** `NavSolutionsNZ/BespoxAI_Web` (renamed from BespokeAI_Web — old URL still redirects)
- **Branch:** `main`
- **Sparse checkout (preferred):** fetch only files needed per task
- **Push command:** `git push origin master:main`
- **Remote URL:** `https://{TOKEN}@github.com/NavSolutionsNZ/BespoxAI_Web.git`

---

## Production File Map

### App Pages (`/app`)

| File | Purpose |
|------|---------|
| `app/page.tsx` | Root/home page |
| `app/layout.tsx` | Root layout, fonts, session provider |
| `app/globals.css` | Global CSS. Body background: `#ffffff`. --white: `#ffffff`. Placeholder: `#8a9a8e`. |
| `app/dashboard/page.tsx` | Main portal. Mobile: slide-over sidebar. Unconnected → `customisations` tab. Nav uses router.push. |
| `app/billing/page.tsx` | Subscription management. Back → `router.push('/dashboard')`. Mobile responsive. |
| `app/admin/page.tsx` | Superadmin portal — 8 tabs. Mobile: slide-over sidebar. ConnectedPill for tenant status. RDP button + copy per tenant. |
| `app/login/page.tsx` | Login. White background. Corner links at 20px for mobile. |
| `app/signup/page.tsx` | Signup. BC + NAV version dropdown with optgroups. Card padding uses clamp(). |
| `app/signup/verify/page.tsx` | Email verification. useEffect calls API on load. Sends notifyAdminsSignupVerified. |
| `app/onboarding/page.tsx` | Post-signup onboarding. Step 0: force password change. Sidebar hidden on mobile. |
| `app/settings/page.tsx` | Customer settings. ProdEnvForm + TestEnvForm sub-components. Mobile: sticky top nav. ChangePasswordCard. Tab changes use router.push (history). Always has ?tab= in URL. Overview shows Production/Test Environment Details cards. |

### API Routes (`/app/api`)

| Route | Purpose |
|-------|---------|
| `api/query/route.ts` | CFO Assistant. Router + planner use jsonMode:true. Addresses user by preferredName ?? firstName. |
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
| `api/requirements/[id]/objects/deploy-test/route.ts` | Deploy to test env. Sets status: 'in_uat' on success. |
| `api/requirements/[id]/objects/deploy-prod/route.ts` | BCAgent prod deploy. |
| `api/requirements/[id]/uat-approve/route.ts` | UAT sign-off. Sets status: 'uat_confirmed'. |
| `api/requirements/[id]/uat-reject/route.ts` | AI scope-creep check. Sets status: 'uat_rejected'. |
| `api/settings/route.ts` | GET/PATCH tenant. Includes navManagementPort + testNavManagementPort. |
| `api/settings/installer/route.ts` | GET returns `{ version: AGENT_VERSION }`. POST generates installer zip. Generates rdpPassword on first download. |
| `api/settings/sync-config/route.ts` | POST — reads all tenant fields from DB, POSTs to BCAgent /bespoxai/update-config. |
| `api/settings/profile/route.ts` | GET/PATCH user firstName/lastName/preferredName |
| `api/settings/profile/change-password/route.ts` | POST — change password. |
| `api/settings/users/route.ts` | GET + POST invite. Sends notifyUserWelcome. mustChangePassword=true on create. |
| `api/settings/users/[id]/route.ts` | PATCH + DELETE. |
| `api/admin/signups/route.ts` | Lists unactivated signup requests only |
| `api/admin/provision/route.ts` | Provision new tenant. agentPort default: 9099. mustChangePassword=true. |
| `api/admin/provision-rdp/route.ts` | POST — adds CF RDP ingress + DNS for {subdomain}-rdp.bespoxai.com. Isolated from main tunnel flow. |
| `api/admin/ai-config/route.ts` | GET/POST AI config |
| `api/admin/users/[id]/route.ts` | PATCH + DELETE. |
| `api/billing/create-checkout/route.ts` | Stripe subscription checkout |
| `api/onboarding/route.ts` | GET/POST onboarding data. |
| `api/signup/verify/route.ts` | Verifies token, fires notifyAdminsSignupVerified |
| `api/webhooks/stripe/route.ts` | Stripe webhook |

### Components (`/components`)

| File | Purpose |
|------|---------|
| `RequirementsBuilder.tsx` | Full customer flow. STATUS_PIPELINE includes in_uat, uat_confirmed, uat_rejected. UAT panel driven by status. |
| `SuperAdminDashboard.tsx` | Admin overview KPIs. |
| `BillingCharts` (inside SuperAdminDashboard.tsx) | Extracted sub-component — do NOT merge back. |

### Lib Files (`/lib`)

| File | Purpose |
|------|---------|
| `notifications.ts` | All lifecycle emails. displayName() helper: preferredName ?? firstName. getCustomerEmail fetches both fields. |
| `cloudflare.ts` | createTunnel, configureTunnelIngress, createDnsRecord, getTunnelToken, addRdpIngress, createRdpDnsRecord |
| `tenant-context.ts` | `buildTenantContext()` |
| `tenants.ts` | `getTenantById()`, `buildODataUrl()`. agentPort fallback: 9099. |
| `github.ts` | Per-customer GitHub repos. |
| `ai-config.ts` | `getAiConfig()` |
| `auth.ts` | NextAuth config. JWT includes: tenantId, role, onboardingDone, mustChangePassword, navProduct, persona, firstName, preferredName. |

### Scripts (`/scripts`)

| File | Purpose |
|------|---------|
| `Install-BespoxAI.ps1` | BCAgent v3.1 installer. Step 8: BespoxAI-Support account + RDP enable. $SupportAccountPassword param. |
| `Uninstall-BespoxAI.ps1` | Full cleanup. |
| `Uninstall-BespoxAI.bat` | Right-click Run as Administrator shim. |

---

## Database Schema — Key Models

### User
```
name               String?
firstName          String?
lastName           String?
preferredName      String?   -- address by this if set, else firstName (never full name)
mustChangePassword Boolean   @default(false)
role: "superadmin" | "tenant_admin" | "user" | "developer"
```

### Tenant (key fields)
```
tunnelId              String?
tunnelSubdomain       String?
bcPort                Int      -- default 8048
agentPort             Int      -- default 9099
navDatabaseServer     String?
navDatabaseName       String?
navServerInstance     String?
navManagementPort     Int?     @default(7045)
bcInstance            String?
bcCompany             String?
lastCU                String?  -- Last Cumulative Update (manual entry)
testNavDatabaseServer String?
testNavDatabaseName   String?
testNavServerInstance String?
testNavManagementPort Int?     @default(7045)
testBcInstance        String?
testBcCompany         String?
testBcPort            Int?
rdpPassword           String?  -- BespoxAI-Support account password (generated on installer download)
```

### Requirement — Status Values
```
draft | submitted | needs_clarification | in_review | quoted | quote_rejected |
deposit_required | deposit_paid | in_development |
in_uat | uat_confirmed | uat_rejected |
complete_pending_payment | fully_paid | rejected
```

### Known Tenants
| ID | Name | tunnelSubdomain | agentPort |
|----|------|-----------------|-----------|
| cmpgqbg8l0001tqej9wpqsx6g | TestCo1 | testco1 | 9099 |
| cmoqi33pu0000l3b0zusc5hgz | GWM Dev | gwmdev | 8080 |

---

## BCAgent v3.1 — Critical Implementation Notes

### Version — TWO places, bump every push
1. `$AgentVersion = '3.1'` and `$Version = '3.1'` in `Install-BespoxAI.ps1`
2. `const AGENT_VERSION = '3.1'` in `app/api/settings/installer/route.ts`

### RDP Support (Step 8 of installer)
- Creates `BespoxAI-Support` local account (or updates password if exists)
- Adds to Remote Desktop Users + Administrators groups
- Enables RDP: `Set-ItemProperty fDenyTSConnections = 0`
- Enables RDP firewall rule
- Password baked in from `$SupportAccountPassword` param
- Password generated in installer route, stored as `rdpPassword` in DB

### Sync Config to Agent
- **UI:** "↑ Sync Config to Agent" button in Settings → BC Installer tab
- **API:** POST /api/settings/sync-config
- **BCAgent endpoint:** POST /bespoxai/update-config
- Does NOT sync bcPassword/bcUsername or rdpPassword

### Deploy Pipeline Flow
```
Admin UI → Sync from GitHub → DB
         → Write files to BCAgent server
         → Deploy + Compile to Test  ✅ WORKING
         → Deploy + Compile to Production  (code ready, not yet tested)
```
On successful deploy to test → requirement status set to 'in_uat'

---

## Vercel MCP Access
- **Team ID:** `team_eZ4MqWjZdsPA2iWoK4exjjPF`
- **Project ID:** `prj_AT4GXatATIi2FaUCS62Ttp2AivRo`
- Use `Vercel:list_deployments` + `Vercel:get_deployment_build_logs` to check errors

---

## Navigation Rules
- Never use `router.back()` — always explicit `router.push()`
- Back buttons: Settings/Billing → `/dashboard`
- Settings: always push tab changes to URL; `router.replace('/settings?tab=overview')` on load if no tab
- Dashboard nav: `router.push` (not replace) — back button works through tab history
- Unconnected dashboard users default to `customisations` tab

---

## What NOT to Do

- ❌ Don't edit root `index.html` — edit `public/index.html`
- ❌ Don't use `cmoqi33pu0000l3b0zusc5hgz` as the test tenant ID — that's GWM Dev
- ❌ Don't run `prisma migrate` — use `db push` or raw SQL
- ❌ Don't use `git push origin main` — use `git push origin master:main`
- ❌ Don't use old repo URL (BespokeAI_Web) — use BespoxAI_Web
- ❌ Don't use `&&` shortcircuit JSX in large functions — use `cond ? <JSX/> : null`
- ❌ Don't use template literals `${var}` in JSX — use string concatenation
- ❌ Don't merge BillingCharts back into SuperAdminDashboard — it's extracted for SWC
- ❌ Don't push without checking imports
- ❌ Don't import `@anthropic-ai/sdk` in API routes
- ❌ Don't use `router.back()` — always explicit `router.push()`
- ❌ Don't use controlled inputs in settings page — use refs + defaultValue
- ❌ Don't default agent port to 8080 — it's 9099
- ❌ Don't run BCAgent as SYSTEM — it must run as the BC user account
- ❌ Don't use HttpClient in BCAgent — use HttpWebRequest (WinHTTP-backed NTLM)
- ❌ Don't push changes without explicit confirmation from Rich
- ❌ Don't assume timeout on deploy errors — check Vercel MCP logs first
- ❌ Don't implement significant architectural changes without discussion first
- ❌ Don't bump version in only one place — always BOTH PS1 and installer/route.ts
- ❌ Don't address users by full name — use preferredName ?? firstName only
- ❌ Don't use router.replace for tab navigation — use router.push for history
