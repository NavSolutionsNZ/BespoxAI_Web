# BespoxAI Web Portal — Files & Structure Inventory

**Last Updated: June 15, 2026 (Session 23)

---

## ⚠️ Architecture Notes

- Live product at bespoxai.com is a full **Next.js application**
- **`public/index.html`** is the LIVE homepage
- AI provider is configurable via admin UI (OpenAI gpt-4o currently active for TestCo1)
- BCAgent v3.3 — PowerShell HttpListener service, full deployment workflow
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
- **(S23) Canonical partner domain = `partners.bespoxai.com`** (PLURAL — confirmed on Vercel project domains). Singular `partner.bespoxai.com` does NOT exist. Partner links use `PARTNER_PORTAL` env/const, NOT main `PORTAL`/bespoxai.com.
- **(S23) Partner portal theme system:** semantic `--rb-*` CSS vars in `globals.css`, two scopes `[data-rb-theme="dark|light"]`. Surfaces set `data-rb-theme` on an ancestor; components ref only `--rb-*`. Partner default `dark` (= original look). Admin Dev Plan card forces `data-rb-theme="dark"`. To re-theme any new partner UI: use `var(--rb-*)`, never hardcode hex.
- **(S23) Shared component pattern:** `components/DevPlanPanel.tsx` is theme-agnostic + role-flagged (`showPricing`). The template for future shared partner↔admin panels (feasibility/dev-notes/coding still duplicated).
- **(S23) partnerTier gates partner dev tooling:** self_serve = full; referral = 403 on dev routes + devPlan stripped from GET. Use `assertPartnerCanDevelop`/`getPartnerTier` from `lib/partner-auth.ts`.

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
| `app/globals.css` | Global CSS. Body background: `#ffffff`. --white: `#ffffff`. Placeholder: `#8a9a8e`. **(S23)** `--rb-*` semantic theme vars in two scopes: `[data-rb-theme="dark"]` (partner palette) + `[data-rb-theme="light"]` (BespoxAI parchment). ~22 vars consumed by partner portal + shared DevPlanPanel. |
| `app/dashboard/page.tsx` | Main portal. Mobile: slide-over sidebar. Unconnected → `customisations` tab. Nav uses router.push. |
| `app/billing/page.tsx` | Subscription management. Back → `router.push('/dashboard')`. Mobile responsive. |
| `app/admin/page.tsx` | Superadmin portal — 8 tabs. Mobile: slide-over sidebar. ConnectedPill for tenant status. RDP button + copy per tenant. **(S23)** Dev Plan render now via shared `<DevPlanPanel showPricing={true}/>` wrapped in `data-rb-theme="dark"` (was 174-line inline block). |
| `app/login/page.tsx` | Login. White background. Corner links at 20px for mobile. |
| `app/signup/page.tsx` | Signup. BC + NAV version dropdown with optgroups. Card padding uses clamp(). |
| `app/signup/verify/page.tsx` | Email verification. useEffect calls API on load. Sends notifyAdminsSignupVerified. |
| `app/onboarding/page.tsx` | Post-signup onboarding. Step 0: force password change. Sidebar hidden on mobile. |
| `app/settings/page.tsx` | Customer settings. ProdEnvForm + TestEnvForm sub-components. Mobile: sticky top nav. ChangePasswordCard. Tab changes use router.push (history). Always has ?tab= in URL. Overview shows Production/Test Environment Details cards. |

### Partner Portal Pages (`/app/partner`) — theme-aware (S23)

| File | Purpose |
|------|---------|
| `app/partner/layout.tsx` | **(S23)** Wraps portal in `PartnerThemeProvider`; `PartnerLayoutInner` consumes `usePartnerTheme()` + sets `data-rb-theme` on root + loading divs. All hex → `var(--rb-*)`. |
| `app/partner/partner-theme-provider.tsx` | **(S23, new)** Fetches `/api/partner/account` → `partnerTheme`; `usePartnerTheme()` context {theme,setTheme,loaded}; defaults `dark` until loaded. |
| `app/partner/settings/page.tsx` | Partner settings. **(S23)** New Appearance section: Dark/Light toggle, persists via `saveSection('theme',{partnerTheme})` + `setTheme` live. Admin-only (account-wide). All hex → vars. |
| `app/partner/tenants/[id]/page.tsx` | Partner tenant detail + self-contained `RequirementDetail` (does NOT use RequirementsBuilder.tsx). **(S23)** 5 AI panels (feasibility/spec/dev-plan/dev-notes/coding), `CollapsibleCard` w/ status-based defaults, SSE streaming for dev-notes+coding, `extractCalObjects` + commit. Dev Plan via shared `<DevPlanPanel showPricing={false}/>`. All hex → vars. Requirement type +devPlan/feasibilityCheckedAt/githubBranch. |
| `app/partner/dashboard|team|billing/page.tsx`, `tenants/new/page.tsx` | **(S23)** All hex → `var(--rb-*)` for theme support. |

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
| `api/requirements/[id]/assign/route.ts` | PATCH — admin reassign requirement to another developer. Sends notifyRequirementAssigned. |
| `api/requirements/[id]/mark-unable/route.ts` | POST — developer marks requirement as unable to complete. Sends notifyAdminRequirementUnableToComplete. |
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
| `api/webhooks/stripe/route.ts` | Stripe webhook. Partner lookups use findFirst on stripeCustomerId (now @unique). Maps branded price → tier='branded'+isWhiteLabel=true; revalidateTag('branding') on white-label flip on/off. |
| `api/health/route.ts` | GET — pings tenant BCAgent /health. Guards null tenantId (partner/superadmin) → 200 {status:'no_tenant'}. Polled every 60s by portal. |
| `api/branding/route.ts` | GET branding for current user. Server unstable_cache tagged ['branding']. Client (branding-provider.tsx) fetches with cache:'no-store'. |
| `api/admin/partners/[id]/activate/route.ts` | Activates partner. Calls revalidateTag('admin-partners') so partner appears immediately. |
| `api/admin/partners/[id]/resend-welcome/route.ts` | POST superadmin-only — fresh temp password + re-hash onto partner_admin user + notifyPartnerWelcome. 502 if email throws. |
| `api/partner/account/route.ts` | GET/PATCH partner account (branding etc). PATCH calls revalidateTag('branding'). |
| `api/partner/billing/create-checkout/route.ts` | Partner Stripe checkout. success_url/cancel_url → /partner/settings (NOT /settings). |
| `api/partner/tenants/[id]/requirements/[reqId]/ai-spec/route.ts` | Partner spec generation. Mirrors customer ai-spec logic with partner auth. |
| `api/partner/tenants/[id]/requirements/[reqId]/feasibility/route.ts` | **(S23)** Partner feasibility check. Mirrors direct route. requirePartnerSession + assertTenantBelongsToPartner + assertPartnerCanDevelop. |
| `api/partner/tenants/[id]/requirements/[reqId]/dev-plan/route.ts` | **(S23)** Partner dev-plan gen. OpenAI branch uses fetch (no SDK). Live BC field introspection. |
| `api/partner/tenants/[id]/requirements/[reqId]/dev-notes/route.ts` | **(S23)** Partner streaming dev assistant. Ghostwrites as **partner consultant + partner brand** (brandName/name from account; consultant from session user), NOT BespoxAI. Respects cfg.features.devAssistant. |
| `api/partner/tenants/[id]/requirements/[reqId]/coding-assistant/route.ts` | **(S23)** Partner streaming C/AL coding assistant. Loads C/AL from partner GitHub branch via resolvePartnerToken (partner org → BespoxAI fallback). |
| `api/partner/tenants/[id]/requirements/[reqId]/coding-assistant/commit/route.ts` | **(S23)** Commits accepted C/AL object back to the partner GitHub branch. |
| `api/partner/tenants/[id]/requirements/route.ts` | List/create partner-tenant requirements. POST sets `assignedDeveloperId: session.userId` (Bug 1 fix — required FK, no DB default). Notifies partner via notifyPartnerNewRequirement. **(S23)** GET returns `devPlan` for self_serve partners, strips for referral (getPartnerTier). |
| `api/partner/tenants/[id]/requirements/[reqId]/route.ts` | Partner PATCH — BOTH customer + deliverer transitions (S22). Deliverer half: in_review, needs_clarification (+QALog), quoted, deposit_paid, in_development, complete_pending_payment, fully_paid + quote/consultantNote/bcObjects. Payments manual (no Stripe). Notifications route to partner/client/BespoxAI per stage. |
| `api/partner/tenants/[id]/requirements/[reqId]/uat-approve/route.ts` | Partner UAT sign-off (S22) → uat_confirmed. notifyPartnerUatApproved. |
| `api/partner/tenants/[id]/requirements/[reqId]/uat-reject/route.ts` | Partner UAT reject (S22) with AI scope-creep analysis (mirrors direct route). notifyPartnerUatRejected. |
| `api/partner/tenants/route.ts` | List/create partner tenants. Select includes `tunnelId` (Bug 5 — connection pill). |

### Components (`/components`)

| File | Purpose |
|------|---------|
| `RequirementsBuilder.tsx` | Full customer flow. STATUS_PIPELINE includes in_uat, uat_confirmed, uat_rejected. UAT panel driven by status. Assignment system: auto-assign to creator, admin reassign modal with workload indicators, dev mark unable. Developers see only their assigned requirements. Regen button shown ONLY in draft status; spec read-only thereafter. |
| `SuperAdminDashboard.tsx` | Admin overview KPIs. |
| `BillingCharts` (inside SuperAdminDashboard.tsx) | Extracted sub-component — do NOT merge back. |
| `DevPlanPanel.tsx` | **(S23)** Shared, theme-agnostic Dev Plan render. Used by partner detail + admin page. Refs only `--rb-*` vars (surface sets `data-rb-theme`). `showPricing` prop gates BespoxAI day-rate/suggested-quote/quoting-notes (true=admin, false=partner). Slice 3 Stage B. Other 3 AI panels (feasibility/dev-notes/coding) NOT yet shared — future work. |

### Lib Files (`/lib`)

| File | Purpose |
|------|---------|
| `notifications.ts` | All lifecycle emails. displayName() helper: preferredName ?? firstName. getCustomerEmail fetches both fields. **Partner pipeline (S22):** getPartnerRecipients(tenantId) → partner_admin+partner_developer; notifyPartner{NewRequirement,Answered,QuoteRejected,UatApproved,UatRejected}. notifyAdmins* = BespoxAI superadmins (direct pipeline only). **(S23)** `PARTNER_PORTAL = process.env.PARTNER_PORTAL_URL ?? 'https://partners.bespoxai.com'`; ALL partner links use it (not PORTAL/main domain). Agreement PDF link removed (scrollable-accept now). |
| `partner-auth.ts` | requirePartnerSession, assertTenantBelongsToPartner. **(S23)** assertPartnerCanDevelop (throws→403 for referral tier), getPartnerTier (returns tier, defaults self_serve). |
| `cloudflare.ts` | createTunnel, configureTunnelIngress, createDnsRecord, getTunnelToken, addRdpIngress, createRdpDnsRecord |
| `tenant-context.ts` | `buildTenantContext()` |
| `tenants.ts` | `getTenantById()`, `buildODataUrl()`. agentPort fallback: 9099. |
| `github.ts` | Per-customer GitHub repos. |
| `ai-config.ts` | `getAiConfig()` |
| `auth.ts` | NextAuth config. JWT includes: tenantId, role, onboardingDone, mustChangePassword, navProduct, persona, firstName, preferredName. |

### Scripts (`/scripts`)

| File | Purpose |
|------|---------|
| `Install-BespoxAI.ps1` | BCAgent v3.3 installer. Step 8: BespoxAI-Support account + RDP enable. $SupportAccountPassword param. Bug fixed v3.2: param inject trailing comma mismatch. agent.config.json version now dynamic. |
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

### PartnerAccount (key fields) — S23 additions
```
brandName            String?   -- white-label brand (used by partner dev-notes ghostwriter)
subscriptionTier     String?   -- unbranded | branded (white-label)
partnerTier          String    @default("self_serve")  -- self_serve | referral (S23)
                                -- self_serve: full in-portal AI requirements tooling
                                -- referral: partner sets up tenant only; BespoxAI manages reqs; dev routes 403
partnerTheme         String    @default("dark")  -- dark | light (S23) — portal colour theme
```
Note: partnerTier/partnerTheme via raw SQL (ALTER TABLE ... ADD COLUMN IF NOT EXISTS). Both applied + in schema.prisma.

### Requirement — Status Values
```
draft | submitted | needs_clarification | in_review | quoted | quote_rejected |
deposit_required | deposit_paid | in_development |
in_uat | uat_confirmed | uat_rejected |
complete_pending_payment | fully_paid | rejected
```

### Requirement — Assignment Fields
```
assignedDeveloperId   String     -- non-nullable, defaults to creating user
assignedDeveloper     User       -- relation to assigned developer
assignedAt            DateTime   -- when assignment occurred
unableToCompleteAt    DateTime?  -- nullable, set when developer marks unable
```

### Known Tenants
| ID | Name | tunnelSubdomain | agentPort |
|----|------|-----------------|-----------|
| cmpgqbg8l0001tqej9wpqsx6g | TestCo1 | testco1 | 9099 |
| cmoqi33pu0000l3b0zusc5hgz | GWM Dev | gwmdev | 8080 |

---

## BCAgent v3.3 — Critical Implementation Notes

### Version — THREE values, all must match, bump every push
1. `$AgentVersion = '3.3'` in `Install-BespoxAI.ps1`
2. `$Version = '3.3'` in `Install-BespoxAI.ps1`
3. `const AGENT_VERSION = '3.3'` in `app/api/settings/installer/route.ts`

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
- ❌ Don't use `findUnique` with non-unique/nullable filters (e.g. `{id, active}` or a nullable tenantId/stripeCustomerId) — it throws "needs at least one of id". Use `findFirst`. (Bit us 3× in Session 21: stripe webhook, getTenantById, health.)
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
- ❌ Don't bump version in only one place — always ALL THREE: $AgentVersion + $Version in PS1 + AGENT_VERSION in installer/route.ts
- ❌ Don't address users by full name — use preferredName ?? firstName only
- ❌ Don't use router.replace for tab navigation — use router.push for history
- ❌ Don't call `getServerSession` directly in new API routes once `lib/api-auth.ts` is rolled out — use its `requireUser` / `requireSuperadmin` / `requireSuperadminOrDeveloper` / `requireTenant` guards (see Roadmap H1). Until rollout, match the guard style of the nearest existing route.

---

## ⚠️ Known Latent Traps (flagged, not yet fixed)

### Misnamed auth guard — `superadminGuard` allows developers too
- **File:** `app/api/admin/requirements/route.ts` (line ~8)
- **Issue:** The function named `superadminGuard` actually permits BOTH `superadmin` AND `developer` roles (`['superadmin', 'developer'].includes(role)`), not superadmin-only as the name implies.
- **Risk:** Anyone copying this guard into a new route by its name, assuming superadmin-only, silently grants developers access they shouldn't have — or breaks developer access if they "correct" the name without checking behavior.
- **Behavior is probably intentional** (developers need to see requirements). The NAME is the problem.
- **Fix when H1 rolled out:** replace with the honestly-named `requireSuperadminOrDeveloper`. Until then, leave behavior as-is; just be aware the name lies.
