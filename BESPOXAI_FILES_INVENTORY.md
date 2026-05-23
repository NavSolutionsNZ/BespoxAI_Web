# BespoxAI Web Portal — Files & Structure Inventory

**Last Updated:** May 23, 2026 (Session 4)

---

## ⚠️ Architecture Notes

- Live product at bespoxai.com is a full **Next.js application**
- **`public/index.html`** is the LIVE homepage
- AI provider is configurable via admin UI (OpenAI gpt-4o currently active for TestCo1)
- BCAgent v2.4 — PowerShell HttpListener service, full deployment workflow
- GitHub per-customer repos — `lib/github.ts`, classic PAT stored as `GITHUB_CUSTOMER_REPOS_TOKEN`
- Default agent port is **9099**

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
git sparse-checkout set --no-cone "components/RequirementsBuilder.tsx" "app/admin/**" "lib/**"
git pull origin main
git config user.email "claude@anthropic.com" && git config user.name "Claude"
```

---

## Production File Map

### App Pages (`/app`)

| File | Purpose |
|------|---------|
| `app/page.tsx` | Root/home page |
| `app/layout.tsx` | Root layout, fonts, session provider |
| `app/globals.css` | Global CSS. Body background: `#ffffff`. Placeholder: `#8a9a8e`. |
| `app/dashboard/page.tsx` | Main portal. Unconnected users default to `customisations` tab. |
| `app/billing/page.tsx` | Subscription management. Back → `router.push('/dashboard')`. |
| `app/admin/page.tsx` | Superadmin portal — 8 tabs. Signups tab hides activated accounts. |
| `app/login/page.tsx` | Login. White background. Tagline: "Business Central & Microsoft NAV Intelligence Portal". |
| `app/signup/page.tsx` | Signup. BC + NAV version dropdown with optgroups. |
| `app/signup/verify/page.tsx` | Email verification. useEffect calls API on load. Sends notifyAdminsSignupVerified. |
| `app/onboarding/page.tsx` | Post-signup onboarding. Step 1: name fields. Step 4: BC connection. Step 5: installer CTA. |
| `app/settings/page.tsx` | Customer settings. ALL inputs use refs + defaultValue (NOT controlled). `?tab=installer` deep-link. |

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
| `api/requirements/[id]/objects/deploy-test/route.ts` | Deploy to test env |
| `api/requirements/[id]/objects/deploy-prod/route.ts` | BCAgent prod deploy |
| `api/requirements/[id]/uat-approve/route.ts` | UAT sign-off |
| `api/requirements/[id]/uat-reject/route.ts` | AI scope-creep check |
| `api/settings/route.ts` | GET/PATCH tenant |
| `api/settings/installer/route.ts` | POST — auto-provisions Cloudflare tunnel on first download. Generates BCAgent installer zip. |
| `api/settings/profile/route.ts` | GET/PATCH user firstName/lastName/preferredName |
| `api/settings/users/route.ts` | GET + POST invite |
| `api/settings/users/[id]/route.ts` | PATCH + DELETE. DELETE also removes SignupRequest. |
| `api/admin/signups/route.ts` | Lists unactivated signup requests only |
| `api/admin/provision/route.ts` | Provision new tenant. agentPort default: 9099. |
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
| `notifications.ts` | All lifecycle emails. Includes notifyAdminsSignupVerified etc. |
| `cloudflare.ts` | `createTunnel()`, `configureTunnelIngress()`, `createDnsRecord()`, `getTunnelToken()` |
| `tenant-context.ts` | `buildTenantContext()` |
| `tenants.ts` | `getTenantById()`, `buildODataUrl()`. agentPort fallback: 9099. agentBaseUrl: `https://${tunnelSubdomain}-agent.bespoxai.com` |
| `github.ts` | Per-customer GitHub repos |
| `ai-config.ts` | `getAiConfig()` |

### Scripts (`/scripts`)

| File | Purpose |
|------|---------|
| `Install-BespoxAI.ps1` | BCAgent v2.4 installer. Port 9099. Runs task as BC user. HttpWebRequest. --protocol http2. |
| `Uninstall-BespoxAI.ps1` | Full cleanup. Removes registry key, cloudflared service, files. |
| `Uninstall-BespoxAI.bat` | Right-click Run as Administrator shim for the PS1. Manually distributed. |

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

### Tenant (key fields)
```
tunnelId           String?  -- Cloudflare tunnel ID (auto-created on first installer download)
tunnelSubdomain    String?  -- e.g. "testco1" → testco1-agent.bespoxai.com (UNIQUE constraint)
bcPort             Int      -- default 8048
agentPort          Int      -- default 9099
navDatabaseName    String?
navDatabaseServer  String?
navServerInstance  String?
bcInstance         String?
bcCompany          String?
testNavDatabaseName   String?
testBcInstance        String?
testBcCompany         String?
```

### Known Tenants
| ID | Name | tunnelSubdomain | agentPort |
|----|------|-----------------|-----------|
| cmpgqbg8l0001tqej9wpqsx6g | TestCo1 | testco1 | 9099 |
| cmoqi33pu0000l3b0zusc5hgz | GWM Dev | gwmdev | 8080 |
| cmoqtoiyv0000f8pfhcpdfqyo | GWM2_AutoInstall | gwm2 | 8080 |
| cmoInpd4v0001bf6xftw1v8h0 | Test Comp 1 | testcomp1 | 8080 |

---

## BCAgent v2.4 — Critical Implementation Notes

### Scheduled Task
- Runs as BC user (e.g. incadea\9lancasterr), NOT SYSTEM
- Password stored in Windows Task Scheduler credential store
- Use `schtasks.exe /change /tn "BespoxAI-BCAgent" /ru {user} /rp {password}` to update user

### Authentication to BC OData
- `$webReq.UseDefaultCredentials = $true` — uses Windows token of the running user
- No explicit NetworkCredential needed
- Equivalent to browser SSO

### Cloudflare Tunnel Service
- Runs as SYSTEM (Windows service)
- Uses `--protocol http2` to avoid QUIC/UDP blocks
- Service recovery: restart after 5s/10s/30s
- Points to `localhost:9099`

### agent.config.json
- Location: `C:\BespoxAI\Agent\agent.config.json`
- Permissions: locked to Administrators + SYSTEM (can't open in Explorer, use PowerShell)
- Contains: apiKey, bcUsername, bcPassword, bcInstance, bcCompany, bcPort, agentPort

---

## Settings Page — Input Pattern (CRITICAL)

**All form inputs in settings/page.tsx use refs + defaultValue, NOT controlled inputs.**

```tsx
const refs = { fieldName: useRef<HTMLInputElement>(null) }
<input ref={refs.fieldName} defaultValue={initial.fieldName} ... />
const val = refs.fieldName.current?.value || ''
```

---

## CFO Assistant — Query Pipeline

```
POST /api/query
  → Router (callAI, jsonMode:true) → needsData true/false
  → if needsData: Planner (callAI, jsonMode:true) → entity + OData params
  → OData fetch: https://{subdomain}-agent.bespoxai.com/{bcInstance}/ODataV4/Company('{bcCompany}')/{entity}?{params}
    Header: X-BespoxAI-Key: {apiKey}
  → BCAgent validates key, forwards to http://localhost:{bcPort}/{bcInstance}/ODataV4/...
    (UseDefaultCredentials=true for NTLM/Kerberos)
  → Answerer (callAI) → structured response
  → QueryLog (tenantId, userId, question, answer, entity, displayHint, recordCount)
```

### Bad Query Steering
QueryLog entries with `entity = '__BAD_QUERY__'` steer the router away from similar queries.
Always clear these when debugging routing issues — use correct tenantId (not GWM Dev).

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
- ❌ Don't add outside-sparse-area files without `git sparse-checkout add <file>` first
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
- ❌ Don't clear bad queries for cmoqi33pu0000l3b0zusc5hgz (GWM Dev) when debugging TestCo1
