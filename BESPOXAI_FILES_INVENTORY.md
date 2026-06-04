# BespoxAI Web Portal — Files & Structure Inventory

**Last Updated: June 4, 2026 (Session 13)**

---

## ⚠️ Architecture Notes

- Live product at bespoxai.com is a full **Next.js application**
- **`public/index.html`** is the LIVE homepage
- AI provider is configurable via admin UI (OpenAI gpt-4o currently active for TestCo1)
- BCAgent v3.2 — PowerShell HttpListener service, full deployment workflow
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
| `app/settings/page.tsx` | Customer settings. ProdEnvForm + TestEnvForm sub-components. BC Installer tab hidden for managedByPartner users. "To configure" hint hidden for partner-managed users. |
| `app/partner/layout.tsx` | Partner portal — dark sidebar layout, auth guard. Settings + Team nav visible to all partner roles. |
| `app/partner/dashboard/page.tsx` | Partner dashboard — clients-only (stat cards + tenant table). No tabs. |
| `app/partner/team/page.tsx` | Partner team management — invite, role change, remove. Admin edit / developer read-only. |
| `app/partner/settings/page.tsx` | Partner settings — Company Info, Branding, White-label Email, GitHub, Change Password. Admin edit / developer read-only. |
| `app/partner/tenants/[id]/page.tsx` | Client management view — 4 tabs: Overview, Requirements, Users, BCAgent |
| `app/partner/tenants/new/page.tsx` | Add Client form — full BC/NAV config, BC service account, optional test env |
| `app/partner-site/page.tsx` | partners.bespoxai.com marketing landing page |
| `app/partner-site/signup/page.tsx` | Partner signup form |
| `app/partner-site/signup/verify/page.tsx` | Email verification status page |

### API Routes (`/app/api`)

| Route | Purpose |
|-------|---------|
| `api/query/route.ts` | CFO Assistant. Router + planner use jsonMode:true. Addresses user by preferredName ?? firstName. |
| `api/requirements/route.ts` | List/create requirements. Returns 403 if tenantId is null (partner users). |
| `api/requirements/[id]/route.ts` | GET/update/delete. All customer notify calls pass tenantId. |
| `api/requirements/[id]/ai-spec/route.ts` | Spec gen |
| `api/requirements/[id]/feasibility/route.ts` | Feasibility |
| `api/requirements/[id]/dev-notes/route.ts` | Dev assistant streaming |
| `api/requirements/[id]/dev-plan/route.ts` | Dev plan |
| `api/requirements/[id]/coding-assistant/route.ts` | Loads C/AL from GitHub branch. Resolves partner token. |
| `api/requirements/[id]/coding-assistant/commit/route.ts` | Commits C/AL back to branch. Resolves partner token. |
| `api/requirements/[id]/prod-approval/route.ts` | AI generates go-live doc. Passes tenantId to notification. |
| `api/requirements/[id]/prod-approve/route.ts` | Customer approves go-live |
| `api/requirements/[id]/objects/route.ts` | GET + POST JSON upsert. Resolves partner token for GitHub push. |
| `api/requirements/[id]/objects/write/route.ts` | Writes object files to BCAgent deployment folder. |
| `api/requirements/[id]/objects/sync-from-github/route.ts` | Pulls latest files from GitHub branch. Resolves partner token. |
| `api/requirements/[id]/objects/deploy-test/route.ts` | Deploy to test env. Sets status: 'in_uat'. Passes tenantId to notify. |
| `api/requirements/[id]/objects/deploy-prod/route.ts` | BCAgent prod deploy. Passes tenantId to notify. |
| `api/requirements/[id]/manual-deploy-test/route.ts` | Manual deploy to test. Sets in_uat, notifies UAT. |
| `api/requirements/[id]/manual-deploy-prod/route.ts` | Manual deploy to prod. Stamps prodDeployedAt, notifies. |
| `api/requirements/[id]/uat-approve/route.ts` | UAT sign-off. Sets status: 'uat_confirmed'. |
| `api/requirements/[id]/uat-reject/route.ts` | AI scope-creep check. Sets status: 'uat_rejected'. |
| `api/settings/route.ts` | GET/PATCH tenant. |
| `api/settings/installer/route.ts` | GET returns `{ version: AGENT_VERSION }`. POST generates installer zip. |
| `api/settings/sync-config/route.ts` | POST — POSTs to BCAgent /bespoxai/update-config. |
| `api/settings/profile/route.ts` | GET/PATCH user firstName/lastName/preferredName |
| `api/settings/profile/change-password/route.ts` | POST — change password. Used by partner settings page too. |
| `api/settings/users/route.ts` | GET + POST invite. Sends notifyUserWelcome with tenantId. |
| `api/settings/users/[id]/route.ts` | PATCH + DELETE. |
| `api/admin/signups/route.ts` | Lists unactivated signup requests only |
| `api/admin/provision/route.ts` | Provision new tenant. Sends notifyUserWelcome with tenantId. |
| `api/admin/provision-rdp/route.ts` | POST — adds CF RDP ingress + DNS. |
| `api/admin/ai-config/route.ts` | GET/POST AI config |
| `api/admin/users/[id]/route.ts` | PATCH + DELETE. |
| `api/admin/partners/route.ts` | GET list + POST create partner accounts |
| `api/admin/partners/[id]/route.ts` | GET + PATCH. Allows fromEmail field. |
| `api/admin/partners/[id]/activate/route.ts` | POST activate partner signup. Sets tenantId: null. |
| `api/admin/partner-signups/route.ts` | GET pending partner signup requests |
| `api/partner-signup/route.ts` | POST submit partner signup request |
| `api/partner-signup/verify/route.ts` | GET verify email token |
| `api/partner/account/route.ts` | GET/PATCH own PartnerAccount. PATCH covers: contactName, phone, address, gstNumber, billingEmail, brandName, logoUrl, primaryColour, isWhiteLabel, agentBrandName, fromEmail, githubOrg, githubToken (encrypted). |
| `api/partner/tenants/route.ts` | GET list + POST create client tenant |
| `api/partner/tenants/[id]/route.ts` | GET single tenant + users |
| `api/partner/tenants/[id]/requirements/route.ts` | GET list + POST raise on behalf of tenant |
| `api/partner/tenants/[id]/requirements/[reqId]/route.ts` | GET + PATCH customer-side actions |
| `api/partner/tenants/[id]/installer/route.ts` | POST generate installer for partner tenant |
| `api/partner/tenants/[id]/sync-config/route.ts` | POST sync config to agent |
| `api/partner/tenants/[id]/provision-rdp/route.ts` | POST provision RDP for partner tenant |
| `api/partner/users/route.ts` | GET list + POST invite team member (admin only). Sends notifyPartnerTeamWelcome. |
| `api/partner/users/[id]/route.ts` | PATCH role + DELETE remove. Guards last admin. |
| `api/partner/request/route.ts` | POST connection/upgrade request |
| `api/partner/request-state/route.ts` | GET connection/upgrade request state |
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
| `notifications.ts` | All lifecycle emails. getPartnerFromEmail(tenantId) helper. All customer-facing functions + notifyUserWelcome accept tenantId? for white-label from address. notifyPartnerTeamWelcome added. |
| `email.ts` | sendEmail — accepts optional `from` override for white-label. |
| `cloudflare.ts` | createTunnel, configureTunnelIngress, createDnsRecord, getTunnelToken, addRdpIngress, createRdpDnsRecord |
| `tenant-context.ts` | `buildTenantContext()` |
| `tenants.ts` | `getTenantById()`, `buildODataUrl()`. agentPort fallback: 9099. |
| `github.ts` | Per-customer GitHub repos. resolvePartnerToken() exported. tokenOverride threaded through all functions. |
| `crypto.ts` | encryptToken/decryptToken — AES-256-GCM, key from PARTNER_GITHUB_TOKEN_ENCRYPTION_KEY |
| `branding.ts` | BrandingConfig, DEFAULT_BRANDING, resolveBranding() |
| `partner-auth.ts` | requirePartnerSession() + assertTenantBelongsToPartner() |
| `ai-config.ts` | `getAiConfig()` |
| `auth.ts` | NextAuth config. JWT includes: tenantId, role, onboardingDone, mustChangePassword, navProduct, persona, firstName, preferredName, managedByPartner, partnerRole, partnerAccountId. |

### Scripts (`/scripts`)

| File | Purpose |
|------|---------|
| `Install-BespoxAI.ps1` | BCAgent v3.2 installer. Step 8: BespoxAI-Support account + RDP enable. |
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
tenantId           String?   -- nullable: partner users have no tenant
role: "superadmin" | "tenant_admin" | "user" | "developer"
```

### Tenant (key fields)
```
tunnelId              String?
tunnelSubdomain       String?
partnerAccountId      String?   -- set if managed by a partner
bcPort                Int      -- default 8048
agentPort             Int      -- default 9099
navDatabaseServer     String?
navDatabaseName       String?
navServerInstance     String?
navManagementPort     Int?
bcInstance            String?
bcCompany             String?
lastCU                String?
testNavDatabaseServer String?
testNavDatabaseName   String?
testNavServerInstance String?
testNavManagementPort Int?
testBcInstance        String?
testBcCompany         String?
testBcPort            Int?
rdpPassword           String?
connectionRequestedAt      DateTime?
connectionRequestedToEmail String?
upgradeRequestedAt         DateTime?
upgradeRequestedToEmail    String?
```

### PartnerAccount (key fields)
```
name             String
slug             String   @unique
contactName      String?
phone            String?
address          String?
gstNumber        String?
billingEmail     String
brandName        String?
logoUrl          String?
primaryColour    String?
agentBrandName   String?
isWhiteLabel     Boolean  @default(false)
fromEmail        String?  -- white-label from address (BespoxAI SMTP, display name only for now)
githubOrg        String?
githubToken      String?  -- AES-256-GCM encrypted
paymentMode      String   -- 'bespoxai_collected' | 'partner_collected'
revenueSharePartner Decimal @default(0.60)
bankAccount      String?
isActive         Boolean  @default(true)
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

## BCAgent v3.2 — Critical Implementation Notes

### Version — THREE values, all must match, bump every push
1. `$AgentVersion = '3.2'` in `Install-BespoxAI.ps1`
2. `$Version = '3.2'` in `Install-BespoxAI.ps1`
3. `const AGENT_VERSION = '3.2'` in `app/api/settings/installer/route.ts`

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
- ❌ Don't push changes without explicit confirmation from Rich
- ❌ Don't bump version in only one place — always ALL THREE
- ❌ Don't address users by full name — use preferredName ?? firstName only
- ❌ Don't use router.replace for tab navigation — use router.push for history
- ❌ Don't rewrite large files via Python str_replace — use create_file or heredoc for full rewrites; Python patches are for targeted single-occurrence replacements only
